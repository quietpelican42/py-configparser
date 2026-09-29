"""CPython side of the string-function differential.

    python3 scripts/oracle_str.py strings.json results.json

For each input string: repr, lower, strip, int(), float(). Also emits a sha256
over the per-code-point behaviour of all 0x110000 code points ("cp_hash"); the
same digest is computed by test/support/strfn.ts.
"""
import hashlib
import json
import struct
import sys


def attempt(fn, s):
    try:
        v = fn(s)
    except Exception as e:  # noqa: BLE001
        return {"e": [type(e).__name__, str(e)]}
    if isinstance(v, float):
        return {"f": "nan" if v != v else struct.pack(">d", v).hex()}
    return {"i": str(v)}


def one(s):
    return {
        "repr": repr(s),
        "lower": s.lower(),
        "strip": s.strip(),
        "int": attempt(int, s),
        "float": attempt(float, s),
    }


def cp_hash():
    h = hashlib.sha256()
    for c in range(0x110000):
        s = chr(c)
        lo = s.lower()
        i = attempt(int, "1" + s + "2")
        f = attempt(float, "1" + s + ".5")
        line = "%x|%s|%s|%d|%s|%s\n" % (
            c,
            repr(s),
            ".".join("%x" % ord(x) for x in lo),
            1 if s.strip() == "" else 0,
            json.dumps(i, sort_keys=True, separators=(",", ":")),
            json.dumps(f, sort_keys=True, separators=(",", ":")),
        )
        h.update(line.encode("utf-8", "surrogatepass"))
    return h.hexdigest()


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        strings = json.load(f)
    out = {"python": sys.version.split()[0], "cp_hash": cp_hash(), "results": [one(s) for s in strings]}
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=True, separators=(",", ":"))


if __name__ == "__main__":
    main()
