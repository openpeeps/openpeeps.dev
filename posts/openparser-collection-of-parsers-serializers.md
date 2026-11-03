---
title: "The cursed collection of tiny parsers and serializers"
date: ""
tags: [package, nim, json, yaml, toml, ical, mime]
categories: ["packages"]
draft: false
---

Initially, I started this project out of the need for a `json`, `yaml` and `toml` library with a uniform API, direct-to-object mapping and custom hooks similar to `pkg/jsony`. It worked! Sure, the project was accelerated with the help of an LLM and... guess what, I ended up with a collection of over 20 parsers, dumpers, serializers, encoders (call them what you like), which can provide a very solid base for building higher level projects in Nim.

The modules include: JSON, TOML, YAML, XML, CSV, BSON, Plist, HTML, CSS, RSS & Atom, DotEnv, iCal, vCard, MIME, NIF, SQL, Regex, Fuzzy, Diff, Gettext, FBE, QR, SVG and Colors.

The philosophy is simple: the same pattern everywhere. You either parse into a tree (`JsonNode`, `XmlNode`, `YAMLObject`, `TomlDocument`), or directly into your own object with `fromJson(data, Person)`, `parseYAML(data, Config)`, `fromXml(data, Person)`, `parseTOML(data, Config)`, `parsePlist(data, Person)`. And if you have custom types, you extend them with `parseHook` / `dumpHook`, rename fields with `renameHook` or a pragma (`{.json: "username".}`, `{.toml: "x".}`, `{.plist: "Name".}`), while errors come with context, snippet + line/column, not just "invalid token".

Installation:

```bash
nimble install openparser
```

or... maybe you wanna try the badass alternative nim package manager:
```bash
clue install openparser
```
_more about clue [here](https://github.com/openpeeps/clue)_

## Examples

For a simple object in Nim:
```nim
type
  Person = object
    name: string
    age: uint
```

Auto-mapping from JSON to Nim types:
```nim
import openparser/json

let data = """{"name":"Ada","age":40,"email":"ada@example.com"}"""
echo fromJson(data, Person) # Person(name: "Ada", ...)
```

The same dance with YAML and TOML
```nim
import openparser/[yaml, toml]

let data = "name: Greg\nage: 50\nemail: greg@example.com"
assert fromYaml(data, Person) == fromToml(data, Person)
```

> This article walks through each module with practical examples, different from the ones in the README. If you just want the quick reference, the README remains the official source.

## 1. JSON, walnut sweet bread

Zero-copy parsing with SIMD tokenization is built for speed, but the API is what keeps you here: `JsonNode` for quick exploration, `fromJson(data, T)` for direct mapping, `toJson` / `toStaticJson` for serialization, `fromJsonFile` via memfile for large files, `fromJsonL` for line-delimited JSON and `JsonOptions(maxDepth: ...)` as DoS protection.

Say you keep the recipes of a bakery:

```nim
import openparser/json
import std/options

type
  Ingredient = object
    name: string
    grams: int
  Recipe = object
    title: string
    minutes: int
    ingredients: seq[Ingredient]
    vegan {.json: "is_vegan".}: Option[bool]

let raw = """{
  "title": "Walnut sweet bread",
  "minutes": 90,
  "ingredients": [{"name": "flour", "grams": 500}, {"name": "walnuts", "grams": 300}],
  "is_vegan": false
}"""

# 1. free exploration
let node: JsonNode = fromJson(raw)
echo node["ingredients"][1]["name"].getStr() # walnuts

# 2. directly into an object
let r: Recipe = fromJson(raw, Recipe)
echo r.ingredients.len # 2

# 3. back to JSON, pretty or compact
echo toJson(r)

# 4. large file, without loading it all into RAM as a string
let catalog = fromJsonFile("recipes.json")

# 5. NDJSON / JSONL, one recipe per line
# let recipes: seq[Recipe] = fromJsonL(readFile("recipes.jsonl"), Recipe)
```

With `parseHook` you can teach the parser new types (for example a distinct `Weight`), and with `renameHook` you map `snake_case` from external APIs to `camelCase` in Nim without a pragma on every field.

## 2. YAML, the balcony greenhouse

The OpenParser YAML supports block and inline syntax, comments, literal block scalars `|` / `>` and the same hook-based API as JSON. Perfect for human-readable configs.

```nim
import openparser/yaml

type
  Sensor = object
    pin: int
    threshold: float
  Greenhouse = object
    name: string
    autoWatering: bool
    sensors: seq[Sensor]

let conf = """
# greenhouse v2, updated by grandma
name: South Balcony
autoWatering: true
sensors:
  - {pin: 4, threshold: 32.5}
  - pin: 7
    threshold: 28.0
"""

let gh: Greenhouse = parseYAML(conf, Greenhouse)
echo gh.sensors[0].threshold # 32.5

let tree: YAMLObject = parseYAML(conf)
echo tree["name"].strValue # South Balcony
```

## 3. XML, the vinyl collection

The mapping here is generous: attributes and child elements both land in the object's fields, repeated tags become `seq[T]`, and discriminator-style attributes can pick a variant object branch. Plus entities, CDATA, comments and memfile-based `fromXmlFile`.

```nim
import openparser/xml

type
  Record = object
    artist: string
    title: string
    year: int
  Collection = object
    record: seq[Record]

let xml = """
<collection>
  <record artist="Phoenix" year="1973"><title>Those Who Gave Us Names</title></record>
  <record artist="Cargo" year="1985"><title>Destiny</title></record>
</collection>
"""

let c: Collection = fromXml(xml, Collection)
echo c.record[1].title # Destiny

let n: XmlNode = fromXml(xml)
echo n.children.len # 2
echo toXml(c.record[0], XmlOptions(rootTag: "record"))
```

With `xmlAttrHook` you decide what is an attribute and what is an element on serialization, and with `parseHook` you can parse e.g. a custom `year: Year`.

## 4. TOML, game config

TOML v1.0 with sections, inline tables, arrays of tables, all four calendar date/time types, `inf`/`nan`, integers in other bases and lossless round-trips via `dumpTOML`.

```nim
import openparser/toml

type
  Graphics = object
    resolution: string
    vsync: bool
  Game = object
    title: string
    graphics: Graphics

let conf = """
title = "The Goat and Her Three Kids: Revenge"

[graphics]
resolution = "2560x1440"
vsync = true
"""

let game: Game = parseTOML(conf, Game)
echo game.graphics.resolution

let doc: TomlDocument = parseTOML(conf)
echo doc.get("title").strVal

# dates keep the original literal + its kind
let d = parseTOML("release = 2026-11-03T10:00:00Z")
echo d.get("release").dateKind # tdkOffsetDateTime
```

## 5. CSV, the beehive census

Zero-copy parser over memory-mapped files. You don't load 600MB into RAM, you process row by row via callback. Return `false` to stop early.

```nim
import openparser/csv

var activeHives = 0
parseFile("apiary_2026.csv",
  proc(fields: openArray[CsvFieldSlice], row: int): bool =
    # hive_id, location, frames, honey_kg, queen_ok
    if row == 0: return true # header
    if fields[4].toString() == "yes":
      inc activeHives
    true
)
echo activeHives, " hives with a healthy queen"
```

Delimiter and quote characters are configurable, so European `;` or tabs work too.

## 6. BSON, JSON for Mongo

Encoding/decoding per the BSON 1.1 spec, with all types: ObjectId, Date, Binary, Regex, Timestamp, Decimal128, plus extended JSON v2 notation.

```nim
import openparser/[json, bson]

let card = fromJson("""{"hive":"B-12","honey_kg":42.5,"inspected":true}""")
let bytes: seq[byte] = card.toBson()
let back: JsonNode = fromBson(bytes)
echo back["hive"].getStr() # B-12
```

Useful when talking to MongoDB or when you want a compact binary format without changing your `JsonNode` mental model.

## 7. Plist, the Apple dowry

Full XML + binary `bplist00` codec with autodetect. The same two-step API: `JsonNode` or directly into an object via the `{.plist: "Name".}` pragma. It knows Base64 `<data>`, UTC `<date>`, hex integers, `real` with inf/nan and automatically unarchives NSKeyedArchiver graphs.

```nim
import openparser/plist
import std/times

type
  RecipeApp = object
    name {.plist: "CFBundleName".}: string
    version {.plist: "CFBundleVersion".}: string

let node = parsePlist(readFile("Info.plist"))
echo node["CFBundleName"].getStr()

let app = parsePlist(readFile("Info.plist"), RecipeApp)
let bin: seq[byte] = toBPlist(app)  # for binary distribution
let xmlOut = toXmlPlist(node)       # back to readable XML
```

## 8. HTML, autumn scraper

Tolerant HTML5 parser with configurable policies (what to do with unclosed tags, comments, CDATA, entities) and output as an `HtmlDocument` tree. Also supports files via memfile.

```nim
import openparser/html

let page = """<html><body><h1>Pie 5 bucks</h1><p>today only<!-- comment --></p><img src="pie.jpg">"""
let doc = parseHtml(page)
# with a strict policy for validation
let policy = defaulHtmlParsingPolicy()
let doc2 = parseHtmlFile("classifieds.html", policy)
echo doc2 != nil
```

Ideal for small scrapers where you don't want a whole browser.

## 9. CSS, validation without a browser

The CSS module parses stylesheets, resolves declarations and validates properties. The SVG parser also uses it for the `style` attribute.

```nim
import openparser/css

# conceptual example: extract the declarations of a selector
# and validate them before injecting into a generated SVG
let decls = parseCss("h1 { fill: rebeccapurple; stroke-width: 2px; }")
echo decls.len > 0
```

## 10. RSS & Atom, the morning press

Parse, read from file, fetch from URL and serialize back to XML. Full metadata + entries.

```nim
import openparser/rss
import openparser/feed

# a morning aggregator: city-hall RSS + weather Atom
let news = readRss("city-hall.xml")
echo news.title
echo news.items.len

let weather = parseAtom(readFile("weather.atom"))
echo weather.title
writeFile("combined.xml", toRssXml(news))
let atomBack = toAtomXml(weather)

# remote
# let live = fetchRss("https://example.com/feed.xml")
# let liveAtom = fetchAtom("https://example.com/atom.xml")
```

## 11. DotEnv, the bakery secrets

Parses `.env` with `${VAR}` expansion, command substitution, controlled override and a `get` / `set` / `del` / `has` API. Also knows per-environment loading.

```nim
import openparser/dotenv

# .env:
# OVEN_HOST=localhost
# OVEN_PORT=8080
# OVEN_URL=http://${OVEN_HOST}:${OVEN_PORT}/bake
loadDotenv(".env")

echo get("OVEN_URL") # http://localhost:8080/bake

let entries = parseEnv("HONEY=linden\nJAR=${HONEY}-1kg")
echo entries[1].value # linden-1kg

# loadDotenvForEnv("production") # loads .env.production over .env
```

## 12. iCal, Joe's wedding

RFC 5545 parser and serializer with unfolding/folding at 75 octets, TEXT codecs, DATE / DATE-TIME / DURATION, quoted parameters, VTIMEZONE, nested VALARM and an `extraProps` fallback for `X-` properties.

```nim
import openparser/ical

let cal = parseIcal(readFile("wedding.ics"))
echo cal.prodId
for c in cal.components:
  if c.kind == cckEvent:
    echo c.event.summary # "Joe's wedding, don't forget the cabbage rolls"
    echo c.event.dtStart

# build your own event: christening + a day-before reminder
var cal2 = IcalCalendar(prodId: some("-//Family//Christening//EN"), version: some("2.0"))
var ev = IcalEvent(uid: "maria-christening-2026@example.com")
ev.dtstamp = some(IcalDt(dt: parseIcalDateTime("20261103T080000Z")))
ev.dtStart = some(IcalDt(dt: parseIcalDateTime("20261103T100000Z")))
ev.summary = some("Maria's christening, \"The Cauldron\" restaurant\nplease be on time")
cal2.components.add(IcalComponent(kind: cckEvent, event: ev))
writeFile("christening.ics", toIcal(cal2))
```

## 13. vCard, the village address book

Reads and writes vCard 3.0 + 4.0, emits 4.0 by default, supports `item1.TEL` groups, `TYPE`/`PREF`, photo upgrades from `ENCODING=b` to `data:` URIs, multi-card and a QR bridge.

```nim
import openparser/vcard

let book = parseVCards(readFile("neighbours.vcf"))
echo book[0].fn
for t in book[0].tels:
  echo t.value, " ", t.types

var contact = VCard(version: vv40, fn: "Ileana Cosanzeana")
contact.tels.add(VCardTel(value: "+40721000000", types: @["cell"], pref: some(1)))
contact.emails.add(VCardEmail(value: "ileana@forest.com"))
writeFile("ileana.vcf", toVCard(contact))

# straight to QR, so people can scan it at the fair
let qrPayload = toQrPayload(contact)
echo qrPayload.len > 0
```

## 14. MIME, the letter with sweet bread attached

RFC 5322 / 2045-2049 parser + creator: typed objects, multipart, encoded words, attachment filenames via RFC 2231, base64 and quoted-printable, charset conversion to UTF-8, lenient policy with strict opt-in.

```nim
import openparser/mime

let msg = parseMime(readFile("letter.eml"))
echo msg.subject.get("")
echo msg.fromAddrs[0].addrSpecOf()

var reply = newMessage(
  newMultipart("mixed", @[
    newTextPart("Sending the recipe, see the attachment!"),
    newBinaryPart(readFile("sweet-bread.pdf").stringToBytes(),
      "application/pdf", filename = "sweet-bread.pdf")
  ]),
  fromAddrs = parseMailboxList("grandma@example.com"),
  toAddrs = parseAddressList("grandkids@example.com"),
  subject = "The recipe, with love")
writeFile("reply.eml", toMime(reply))
```

## 15. SQL, three dialects, one parser

Supports PostgreSQL, MySQL and SQLite: SELECT/INSERT/UPDATE/DELETE, JOINs, subqueries, GROUP BY, HAVING, ORDER BY, LIMIT, plus an AST you can inspect or rebuild.

```nim
import openparser/sql

let ast = parseSql("SELECT hive, SUM(honey_kg) AS total FROM apiary WHERE year = 2026 GROUP BY hive ORDER BY total DESC LIMIT 5")
echo ast
# SELECT hive, SUM(honey_kg) AS total FROM apiary WHERE year = 2026 GROUP BY hive ORDER BY total DESC LIMIT 5
```

Good for linters, migrators or a minimal query builder.

## 16. Regex, SIMD engine

Parser + compiler + VM with SSE2/AVX2 acceleration, character classes, quantifiers, alternations, capture groups and anchoring.

```nim
import openparser/regex

# validate license plates: B 123 ABC
let plate = match("B 123 ABC", r"[A-Z]{1,2} \d{2,3} [A-Z]{3}")
echo plate.matched # true

let date = match("2026-11-03", r"(\d{4})-(\d{2})-(\d{2})")
if date.matched:
  echo date.groupStr("2026-11-03", 1) # 2026
  echo date.groupStr("2026-11-03", 3) # 03

echo findAll("aaa bbb ccc", r"[a-c]+").len # 3
```

## 17. Fuzzy, fzf-style search

SIMD fuzzy search with fzf-style scoring: consecutive runs, word boundaries and camel humps score higher, gaps and leading offsets are penalized. Zero allocations per candidate, bounded top-N, positions for highlighting.

```nim
import openparser/fuzzy

let candidates = @["sweet bread", "croissants", "pretzels", "walnut sweet bread"]
for m in fuzzySearch("swe", candidates, FuzzyOptions(limit: 2)):
  echo m.text, " ", m.score # sweet bread ..., walnut sweet bread ...

echo fuzzyScore("honey", "linden honey").matched # true
```

Perfect for a command palette or a file picker.

## 18. Diff, what grandma changed in the recipe

Line-based diff with a structured result + git-compatible unified output. Myers / patience / histogram algorithms, byte-level intra-line spans, precomputed stats, memfile input.

```nim
import openparser/diff

let oldRecipe = "flour 500g\nsugar 200g\nwalnuts 300g\n"
let newRecipe = "flour 500g\nsugar 150g\nwalnuts 300g\nhoney 50g\n"

let d = diff(oldRecipe, newRecipe)
echo renderUnified(d)
echo d.stats        # +1 -1 ~1, etc.
echo d.isIdentical  # false

for hunk in d.hunks:
  for line in hunk.lines:
    if line.kind == dlInsert:
      echo "added line ", line.bLine

let fromFiles = diffFile("recipe-v1.txt", "recipe-v2.txt")
let patient = diff(oldRecipe, newRecipe, DiffOptions(algorithm: daPatience))
```

## 19. Gettext, sweet bread in three languages

Parses and compiles PO/MO with plural-form support, headers and MO binaries.

```nim
import openparser/gettext/[po, mo]

let cat = openPoCatalog("sweet-bread.ro.po")
let cc = compilePo(cat)
echo cc.translate("Honey cake")            # "Cozonac cu miere"
echo cc.ntranslate("nut", "nuts", 5)       # "nuci"
echo parsePoHeaders(cat)["Language"]       # "ro"
writeMoFile(cc, "sweet-bread.mo")
close(cat)
```

## 20. FBE, fast binary packets

Fast Binary Encoding with a compact API (`encodeFinal` / `decodeFinal`) and a low-level API with custom field IDs and versioning. Zero-copy buffers, sequences, nested structs, UUID/timestamp/decimal support.

```nim
import openparser/fbe

type
  Parcel = object
    recipient: string
    kg: int32
    fragile: bool

let p = Parcel(recipient: "Aunt Tamara", kg: 12, fragile: true)
let buf = encodeFinal(p)
var back2 = Parcel()
decodeFinal(buf, back2)
assert back2.recipient == "Aunt Tamara"
```

## 21. NIF, the Nim 2027 intermediate format

Re-exports `nif/ast`, `nif/lexer`, `nif/parser` and adds `fromNif`, `fromNifFile`, `tokenizeNif` with MemFile, lazy global-symbol expansion, depth limiting and context-aware errors.

```nim
import openparser/nif

let src = """
(.nif27)
(stmts
  (proc bake.0. (param dough.1.))
  (call bake.0. "sweet bread"))
"""
let mods = fromNif(src)
echo mods[0].tag # stmts

let toks = tokenizeNif("(stmts 42 \"honey\" :sweet)")
echo toks.len > 0
```

Note: OpenParser's NIF implementation is used in the [Merenda GUI](https://github.com/elcritch/merenda). For more on using Merenda + NIF, check the [NIF demo docs](https://github.com/elcritch/merenda/blob/main/docs/resources.md#nif-demo).

## 22. QR, from poster to scan

The full family: Model 2 (versions 1-40), Micro QR, rectangular rMQR, legacy Model 1, encrypted SQRC-style payloads, payload builders and SVG rendering. Decoding also works from grayscale images, with binarization, finder patterns and Reed-Solomon.

```nim
import openparser/qr

# the fair poster: scan it and land on the recipe
let qr = encodeQr("https://example.com/sweet-bread")
echo decodeQrMatrix(qr).text
writeFile("poster-qr.svg", qr.toSvg(scale = 8, border = 4))

# the guesthouse WiFi, no more dictating passwords
let wifi = encodeQr(makeWifi("Walnut-Guesthouse", "honey2026"))
# business card on the market stall
let card = encodeQr(makeVCard(VCard(fullName: "Merry Apiary",
  org: "Beekeeping", email: "honey@example.com")))

# Micro for the small jar, rMQR for the narrow label
let micro = encodeMicro("LINDEN HONEY 500g")
let narrow = encodeRmqr("lot 4711 exp 2027-05", ecMedium, "R11x139")
```

## 23. SVG, the beehive icon

SVG 1.1 parser with typed DOM, paths, lengths, transforms and a bridge to CSS and Colors. Built on top of the XML and Colors modules.

```nim
import openparser/svg

let srcSvg = """
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <ellipse cx="32" cy="36" rx="20" ry="24" fill="gold" />
  <path d="M22 30 h20 M22 38 h20 M22 46 h20" stroke="brown" stroke-width="2"/>
</svg>
"""
let docSvg = parseSvg(srcSvg)
echo docSvg.root.tag # svgSvg
echo docSvg.root.children.len # 2

let minified = docSvg.toSvg()
let pretty = docSvg.toSvg(SvgSerializeOptions(pretty: true, indentSize: 2, xmlDecl: true))
writeFile("beehive.svg", pretty)
```

## 24. Colors, real CSS Color 4

Parses any CSS color, converts between hex, rgb, hsl, hsv, hwb, cmyk, lab, lch, oklab, oklch, manipulates (lighten/darken/spin/mix/tint/shade), generates harmonies and measures WCAG contrast.

```nim
import openparser/colors

# the honey fair palette: amber, beeswax, linden
let amber = parseColor("oklch(0.75 0.15 80)")
echo amber.toHex() # e.g. #d9a03c
echo amber.complement().toHex()
echo amber.analogous(3).len # 3

let textOnHoney = contrastRatio(parseColor("#3b2500"), parseColor("#ffcf5c"))
echo textOnHoney > 4.5 # readable WCAG AA?
echo mostReadable(parseColor("#3b2500"),
  @[parseColor("white"), parseColor("gold")]).toHex()
```

## Conclusion

From `{"name":"Ada"}` to `bplist00`, from `.env` to encrypted QR, OpenParser covers exactly that thankless work you would otherwise keep rewriting: yet another fast CSV parser, yet another iCal serializer that folds correctly at 75 octets, yet another diff that comes out byte-identical to git. The uniform API means the second module takes five minutes to learn, and the hooks mean you never get stuck when your model is not just `string` + `int`.

The code is on GitHub at `openpeeps/openparser`, with tests for each module and a generated API reference. Grab a small module, dotenv, fuzzy, colors, and see how fast you can integrate it. The other 20 come along for the ride.
