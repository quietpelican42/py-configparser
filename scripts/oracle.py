"""CPython side of the differential test.

    python3 scripts/oracle.py cases.json results.json

Reads a list of cases (see test/support/probe.ts for the schema), runs each one
through CPython's configparser, and writes a snapshot per case: the parse
outcome of every source, the resulting sections/options, and the result (value
or exception class, message and attributes) of a fixed set of probes:
get/getint/getfloat/getboolean/items/options/has_option, write() and edits.
test/support/probe.ts performs the same probes against this library.
"""
import base64
import configparser
import io
import json
import struct
import sys

UNNAMED = "\x00<UNNAMED_SECTION>"


def tag(section):
    return UNNAMED if section is configparser.UNNAMED_SECTION else section


def untag(section):
    return configparser.UNNAMED_SECTION if section == UNNAMED else section


def err(e):
    attrs = {}
    for name in ("section", "option", "source", "lineno", "line", "reference"):
        if hasattr(e, name) and getattr(e, name) is not None:
            v = getattr(e, name)
            attrs[name] = tag(v) if name == "section" else v
    if hasattr(e, "errors"):
        attrs["errors"] = [[n, str(l)] for n, l in e.errors]
    name = type(e).__name__
    if name == "AttributeError":
        name = "TypeError"  # JS has no AttributeError; the message is compared as well
    return {"cls": name, "msg": str(e), "attrs": attrs}


def enc(v):
    if v is None or isinstance(v, str):
        return v
    if isinstance(v, bool):
        return {"b": v}
    if isinstance(v, int):
        return {"i": str(v)}
    if isinstance(v, float):
        if v != v:
            return {"f": "nan"}
        return {"f": struct.pack(">d", v).hex()}
    if isinstance(v, (list, tuple)):
        return [enc(x) for x in v]
    raise TypeError(type(v))


def run(fn):
    try:
        return {"v": enc(fn())}
    except Exception as e:  # noqa: BLE001 - every failure is data here
        return {"e": err(e)}


def make(case):
    o = case["opts"]
    kw = {}
    if "defaults" in o:
        kw["defaults"] = o["defaults"]
    if "allow_no_value" in o:
        kw["allow_no_value"] = o["allow_no_value"]
    if "delimiters" in o:
        kw["delimiters"] = tuple(o["delimiters"])
    for k in ("comment_prefixes", "inline_comment_prefixes"):
        if k in o:
            kw[k] = None if o[k] is None else tuple(o[k])
    for k in ("strict", "empty_lines_in_values", "default_section", "allow_unnamed_section"):
        if k in o:
            kw[k] = o[k]
    interp = o.get("interpolation", "default")
    if interp == "basic":
        kw["interpolation"] = configparser.BasicInterpolation()
    elif interp == "extended":
        kw["interpolation"] = configparser.ExtendedInterpolation()
    elif interp == "none":
        kw["interpolation"] = None
    base = configparser.ConfigParser if case["cls"] == "config" else configparser.RawConfigParser
    if case["xform"] == "str":
        class P(base):
            def optionxform(self, optionstr):
                return optionstr
        base = P
    return base(**kw)


def read_source(p, s):
    if s["kind"] == "string":
        p.read_string(s["text"], s.get("source", "<string>"))
    else:
        f = io.TextIOWrapper(io.BytesIO(base64.b64decode(s["b64"])), encoding=s["encoding"])
        p.read_file(f, s.get("source", "x.cfg"))


def apply_op(p, op):
    kind = op[0]
    if kind == "add_section":
        return p.add_section(op[1])
    if kind == "set":
        return p.set(op[1], op[2], op[3])
    if kind == "remove_option":
        return p.remove_option(op[1], op[2])
    if kind == "remove_section":
        return p.remove_section(op[1])
    if kind == "read_dict":
        return p.read_dict(op[1])
    raise ValueError(kind)


def state(p, case):
    st = {
        "sections": [tag(s) for s in p.sections()],
        "defaults": [[k, v] for k, v in p._defaults.items()],
        "raw": [[tag(s), [[k, v] for k, v in p._sections[s].items()]] for s in p._sections],
    }
    vars_ = case.get("vars") or None
    names = [p.default_section] + list(p.sections())
    probes = []
    for s in names:
        entry = {"s": tag(s)}
        entry["options"] = run(lambda: p.options(s))
        entry["items"] = run(lambda: p.items(s))
        entry["items_raw"] = run(lambda: p.items(s, raw=True))
        entry["items_vars"] = run(lambda: p.items(s, vars=vars_))
        opts = []
        if s == p.default_section:
            optnames = list(p._defaults)
        else:
            optnames = list(dict.fromkeys(list(p._sections[s]) + list(p._defaults)))
        for o in optnames:
            opts.append([o, {
                "get": run(lambda: p.get(s, o)),
                "raw": run(lambda: p.get(s, o, raw=True)),
                "vars": run(lambda: p.get(s, o, vars=vars_)),
                "int": run(lambda: p.getint(s, o)),
                "float": run(lambda: p.getfloat(s, o)),
                "bool": run(lambda: p.getboolean(s, o)),
                "has": p.has_option(s, o),
                "has_up": p.has_option(s, o.upper()),
            }])
        entry["opts"] = opts
        entry["missing"] = run(lambda: p.get(s, "__missing__"))
        entry["fallback"] = run(lambda: p.get(s, "__missing__", fallback="FB"))
        entry["has_missing"] = p.has_option(s, "__missing__")
        probes.append(entry)
    st["probes"] = probes
    st["nosec"] = run(lambda: p.get("__nosec__", "a"))
    st["nosec_fb"] = run(lambda: p.get("__nosec__", "a", fallback=None))
    st["has_section"] = [p.has_section("a"), p.has_section(p.default_section), p.has_section("__nosec__")]
    st["has_option_none"] = [p.has_option(None, "a"), p.has_option("", "a")]
    st["items_names"] = run(lambda: [tag(k) for k, _ in p.items()])

    def w(space):
        b = io.StringIO()
        p.write(b, space_around_delimiters=space)
        return b.getvalue()

    st["write"] = run(lambda: w(True))
    st["write_nospace"] = run(lambda: w(False))
    return st


def do_case(case):
    out = {"ctor": None, "reads": [], "ops": [], "state": None}
    try:
        p = make(case)
    except Exception as e:  # noqa: BLE001
        out["ctor"] = err(e)
        return out
    for s in case["sources"]:
        try:
            read_source(p, s)
            out["reads"].append(None)
        except Exception as e:  # noqa: BLE001
            out["reads"].append(err(e))
    for op in case.get("ops", []):
        try:
            apply_op(p, [untag(x) if isinstance(x, str) else x for x in op])
            out["ops"].append(None)
        except Exception as e:  # noqa: BLE001
            out["ops"].append(err(e))
    out["state"] = state(p, case)
    return out


def main():
    if sys.version_info < (3, 14):
        sys.stderr.write("oracle.py: CPython 3.14 semantics required, found %s\n" % sys.version.split()[0])
        sys.exit(3)
    with open(sys.argv[1], encoding="utf-8") as f:
        cases = json.load(f)
    results = {c["id"]: do_case(c) for c in cases}
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump({"python": sys.version.split()[0], "results": results}, f, ensure_ascii=True, separators=(",", ":"))


if __name__ == "__main__":
    main()
