---
title: "Squeezy, a dead simple JavaScript and CSS bundler and minifier"
date: ""
tags: [package, nim, javascript, css, bundler, minifier]
categories: ["packages"]
draft: false
---

Shipping a small site usually means reaching for NodeJS just to shrink two files. Squeezy is a different thing, a single binary that validates, bundles and minifies JavaScript and CSS, with no runtime to install and no config file to babysit.

It is built with Nim, it ships as one fast binary, or as a Nimble library, easy to integrate with any Nim project (see [how to bundle assets in StupidGreen as example](https://github.com/openpeeps/stupidgreen/blob/main/src/service/provider/bundleassets.nim)). Under the hood it stands on two OpenPeeps parsers, [pkg/sweetsyntax](https://github.com/openpeeps/sweetsyntax) for JavaScript and [pkg/openparser](https://github.com/openpeeps/openparser) for CSS.

Installation:

```bash
nimble install squeezy
```

or, if you like the badass alternative Nim package manager:

```bash
clue install squeezy --build
```

_more about clue [here](https://github.com/openpeeps/clue)_ 🤘

## The pieces, in plain language

Think of Squeezy as glue between two real parsers:

- SweetSyntax reads JavaScript and TypeScript into an AST, with errors that point at the file and line instead of silently passing garbage through. It is both a CLI and a [Nim library](https://github.com/nimbase). As a CLI you can run `sweetsyntax parse`, `sweetsyntax ast`, `sweetsyntax tree` and `sweetsyntax highlight`. As a library you call `parseScript` or `highlight` from your own app. Squeezy uses the library side to validate, to bundle and to print minified code back out.
- OpenParser's CSS module reads stylesheets into a stylesheet tree, validates properties and values, then minifies with knowledge of what each declaration means.

That is why Squeezy can do more than strip whitespace. **It understands imports**, **it understands scopes**, and it **tells you when something is wrong**.

A quick taste of the SweetSyntax side, independent of Squeezy:

```sh
sweetsyntax parse app.js
sweetsyntax highlight app.js --format:ascii
```

```nim
import sweetsyntax
import sweetsyntax/languages/js

let ast = parseScript("app.js", jsHandlers, {featAsync, featArrowFn})
echo dumpTree(ast)
```

If parsing succeeds, Squeezy will bundle it. If it fails, you get the same context aware error, not a broken bundle.

## CSS, one file out

Say you have a small stylesheet that pulls in a reset:

```css
@import './reset.css';

:root {
  --primary-color: #FF8800;
  --font-stack: 'Inter', sans-serif;
}

body {
  margin: 0px;
  background-color: var(--primary-color);
}
```

Run:

```sh
squeezy css styles.css -o styles.min.css
```

Squeezy inlines `./reset.css` at the top, drops comments and collapses whitespace to one line, one file, ready to serve (the reset lands first, then your rules):

```css
*,*::before,*::after{box-sizing:border-box;margin:0px;padding:0px}html{font-size:16px}body{min-height:100vh}img,picture,video,canvas,svg{display:block;max-width:100%}:root{--primary-color:#FF8800;--font-stack:"Inter",sans-serif}body{margin:0px;background-color:var(--primary-color)}
```

This snippet trims a few reset rules for readability, the real output keeps them all on one line. The deeper value optimizations, shortening `#FF8800` to `#F80` and `0px` to `0`, live in the library `minify()` path covered below. The `css` command prioritizes correct inlining and safe whitespace removal.

Two practical notes. First, the minified file can be larger than the input, because the reset is now inside it. You trade one extra request for a few extra bytes, which is usually what you want. Second, comments are gone by default. Keep them when you need to:

```sh
squeezy css styles.css --preserve-comments -o styles.min.css
```

## JS, follow the imports

Take the tiny demo from Squeezy's `examples/` folder. `sample.js` imports a helper:

```js
import { formatDate } from './utils.js';

function greet(name) {
  const greeting = "Hello, " + name + "!";
  console.log(greeting);
  return greeting;
}
```

Bundle it:

```sh
squeezy bundle sample.js -o dist/app.js
```

Squeezy follows `./utils.js`, stitches both files together, and drops the `import` line that is no longer needed. You get one file you can ship or inspect.

Want it small? Add minification:

```sh
squeezy bundle sample.js --minify -o dist/app.js
```

```js
function greet(name){const greeting="Hello, "+name+"!";console.log(greeting);return greeting}
```

Need a single file for a classic `<script>` tag? Wrap it as a global:

```sh
squeezy bundle sample.js --format=iife --name=Demo --minify -o dist/demo.js
```

```js
var Demo=(function(exports){'use strict';function greet(name){const greeting="Hello, "+name+"!";console.log(greeting);return greeting}exports.greet=greet;return exports})({});
```

That `--format` flag covers six targets, `es` (the default), `cjs`, `iife`, `umd`, `amd` and `system`. Only `es` keeps native `import` and `export` statements. The wrapped formats rewrite exports into assignments like `exports.greet = greet`, which is also what makes whole bundle mangling safe.

Mangling shortens local names to single letters. It runs bundle wide, so every file shares the same short name pool:

```sh
squeezy bundle sample.js --format=iife --name=Demo --minify --mangle -o dist/demo.js
```

Note the pairing, mangle implies minify, and in the current version mangling applies to wrapped formats. In plain `es` output Squeezy keeps export names readable so other modules can still import them.

Two more flags you will reach for quickly:

```sh
# leave a dependency to the host environment
squeezy bundle app.js --external react,react-dom

# keep comments, or ship a source map next to the output (es format)
squeezy bundle app.js --preserve-comments
squeezy bundle app.js --format=es --sourcemap -o dist/app.js
```

The last one writes `dist/app.js` plus `dist/app.js.map`, so devtools can map the minified line back to the original file.

## Node style resolution, without Node

This is the part that surprises people. Squeezy resolves bare specifiers like a bundler should, using real `node_modules` lookup:

- relative paths first (`./utils.js`)
- then walked up `node_modules` folders, so nested folders can shadow outer ones
- `package.json` fields in order, `exports` (including subpaths like `pkg/feature`), then `module`, then `main`
- scoped packages (`@scope/pkg`), builtins left alone (`fs`, `node:path`), malformed `package.json` falling back to `index.js`
- escapes when you ask for them, `--external`, `--node-path ./shared`, plus `NODE_PATH`

So this just works, offline, with no install step:

```sh
squeezy bundle npm-bundle/src/entry.js
squeezy bundle npm-bundle/src/entry.js --format=iife --name=Fixture --minify -o dist/bundle.js
squeezy bundle npm-bundle/src/entry.js --external pkg-main
```

No network, no `npm install`, the fixture `node_modules` in the repo is committed on purpose so tests run anywhere.

## Squeezy as a Nim library

The CLI is the easy path, but the same engine is a normal Nim library. This is handy when you build your own tool, a static site generator, an editor plugin, a release script.

```nim
import squeezy/bundle/bundler
import squeezy/bundle/common

let bundled = bundle("examples/sample.js", BundleConfig(minify: true))
writeFile("dist/app.js", bundled)

let one = minify("const a = 1 + 2 * 3;", "js")
echo one # const a=1+2*3

let css = minify("body { margin: 0px; }", "css")
echo css # body{margin:0;}
```

Wrapped output with mangling looks like this from code:

```nim
let outp = bundle("examples/sample.js",
  BundleConfig(minify: true, mangle: true,
    format: fmtIIFE, moduleName: "Demo"))
```

Validation is separate from bundling, so you can lint without writing anything:

```nim
for e in validateJs("const x = 1;"):
  echo e # empty, this one is fine

for e in validateCss("body { color: red; }"):
  echo e
```

And source maps come back as a small object with both parts:

```nim
let res = minifyWithSourceMap(code, "js",
  BundleConfig(minify: true, sourceMap: true), "app.js")
writeFile("dist/app.js", res.code)
writeFile("dist/app.js.map", res.sourceMapRaw)
```

## Two minifiers, pick your tradeoff

Squeezy actually ships two ways to shrink code:

1. The smart one parses first, then prints. It knows operator precedence, so `1 + 2 * 3` stays correct, it folds `true` to `!0`, it keeps regexes, template literals and property names intact while renaming only safe locals.
2. The inline one never parses. It just strips comments and whitespace while respecting strings, template literals, regexes, `url()` and raw HTML tags like `pre` and `code`. It is the fastest option, and it never fails on syntax it does not know.

Use the inline family for embedding snippets, for HTML pages, or when speed matters more than every last byte:

```nim
import squeezy/minify/[inlinejs, inlinecss, inlinehtml]

echo minifyInlineJS("function hi( name ) { /* hi */ return name; }")
# function hi(name){return name;}

echo minifyInlineCSS("body { margin: 0px; /* keep */ }")
# body{margin:0px}

echo HtmlMinifier().minify("<div>  <p>Hello</p> <!-- bye --> </div>")
# <div><p>Hello</p></div>
```

Notice the CSS difference, the smart minifier turns `0px` into `0`, the inline one leaves the value alone. Same philosophy as the rest of Squeezy, no magic, just predictable passes you can reason about.

## How fast is it, really

Benchmarked on a full copy of `d3.js` v7.9.0, about 20k lines, 587043 bytes, rerun locally with `tests/test_benchmark.nim`:

```text
Output sizes:

  Original:              587043 bytes
  squeezy-inline:        420081 bytes
  squeezy-bundle:        410815 bytes
  squeezy-bundle+mangle: 294480 bytes
  esbuild:               281878 bytes

mean over 5 runs:
  squeezy-inline:        7.4 ms
  squeezy-bundle:        56.9 ms
  squeezy-bundle+mangle: 124.9 ms
  esbuild:               59.9 ms
stages over 3 runs (parse/codegen/mangle):
  parse:               51.2 ms
  codegen:             6.4 ms
  codegen+mangle:      73.2 ms
```

Not great, not terrible! Read it like this. The inline pass is brutally fast at `7.4 ms` and already cuts `d3.js` by 28%. The full parse plus codegen bundle lands at `410815` bytes in about `57 ms`, basically side by side with esbuild at 60 ms on this machine. Bundle wide mangling gets to `294480` bytes, within a few percent of esbuild at `281878` bytes, while taking about twice as long. The stage breakdown tells you where the time goes, parsing dominates, codegen is cheap, collecting scopes for mangling costs extra.

That gap is honest and [on the roadmap](https://github.com/openpeeps/squeezy#roadmap), close the esbuild size gap, measured against this exact bench. For many projects the tradeoff already favors Squeezy, one binary, no Node, validation included, output you can read.

### Squeezy vs esbuild at a glance

| Capability | Squeezy | esbuild |
| --- | :---: | :---: |
| Single binary, no Node needed | ✓ | ✓ |
| JS bundling (relative + `node_modules`) | ✓ | ✓ |
| CSS bundling with `@import` inlining | ✓ | ✓ |
| Built-in validator with file and line errors | ✓ | ✓ |
| Minify JS | ✓ | ✓ |
| Minify CSS | ✓ | ✓ |
| Fast inline minifier (no parsing, never fails) | ✓ | ✗ |
| HTML minifier | ✓ | ✗ |
| Identifier mangling | ✓ | ✓ |
| Source maps | ✓ | ✓ |
| Output formats (`es`, `cjs`, `iife`, `umd`, `amd`, `system`) | ✓ | partial (`esm`, `cjs`, `iife`) |
| Usable as a Nim library | ✓ | ✗ |
| Tree shaking | ✗ (roadmap) | ✓ |
| Code splitting | ✗ | ✓ |
| Watch mode | ✗ (roadmap) | ✓ |
| Plugin ecosystem | ✗ | ✓ |

## When Squeezy fits

Pick Squeezy when you want a boring, explainable step in your build. A docs site, a landing page, a Nim web app that needs one JS file and one CSS file. You run two commands, you check the output in, you move on.

It is not trying to replace a full plugin ecosystem. If you need tree shaking across a huge monorepo, code splitting, or CSS source maps today, check the roadmap first. The project is upfront about what is done (re-exports, dynamic `import()`, `require()`, `exports` maps, externals, source maps for `es`) and what is next (a `check` command, conditional `@import` handling, `url()` rebasing, CSS source maps, an `html` command, stdin and `--watch` mode).

Try it on your own files:

```sh
squeezy css styles.css -o styles.min.css
squeezy bundle app.js -o bundle.js --minify --mangle
```

Links: [Squeezy on GitHub](https://github.com/openpeeps/squeezy), [SweetSyntax](https://github.com/openpeeps/sweetsyntax), [OpenParser CSS](https://github.com/openpeeps/openparser). API reference is published from source, examples live in `examples/` and the offline `npm-bundle/` fixture, and issues are welcome if you find a file that should bundle but does not.
