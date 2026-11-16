---
title: "Clue, my alternative package manager for Nim development"
date: ""
tags: [package, nim, tooling, package-manager]
categories: ["packages"]
draft: false
---

I like Nimble. I also swear at it. The moment a real project grows past a handful of deps, the SAT resolver starts acting like a DMV clerk, slow, cryptic, and very sure it is right. So I built the tool I wanted to use, a small DFS resolver with a local registry, a lockfile that actually speeds things up, and commands that do what they say. That tool is [Clue](https://github.com/openpeeps/clue), now at 0.3.8.

This is a dev POV walkthrough, the commands I run daily, plus fresh benchmarks I ran on my own machine with hyperfine. No marketing numbers, just what I saw.

## Install it once

The irony is intentional, you install Clue with Nimble, then you may never touch Nimble again:

```bash
nimble install clue
```

Or grab a binary from [GitHub releases](https://github.com/openpeeps/clue/releases/latest). Either way, add the bin dir to your `PATH` once:

```bash
export PATH="$HOME/.clue/bin:$PATH"
```

Installed binaries land in `~/.clue/bin`. Develop mode packages live as symlinks under `~/.clue/develop`, and Clue will never delete anything outside `~/.clue/packages`, which matters more than it sounds.

Self update is one command:

```bash
clue upgrade
```

My release binary, built with `clue build --release` (that is `-d:release --opt:size` under the hood), is 4.3 MB. The debug build of the same source was 10 MB. Same tool, less than half the weight, noticeably snappier. Everything below was measured with the release binary on Nim 2.4.0, macOS.

## The mental model in 30 seconds

Three ideas explain most of Clue:

1. Local registry, `~/.clue/packages/<name>/<version>`. Cached version discovery, transitive resolution, orphan pruning. One place, no surprises.
2. DFS resolution, nearest wins. Constraints declared closest to the root are hard, deeper ones are soft tie breakers. Deps are only expanded for versions actually explored, failed choices backtrack until something satisfies, or you get a clear conflict error. Middle school stuff, no PhD required.
3. `clue.lock` at the package level. First build resolves everything and writes the lock. Next build reuses it when the fingerprint matches and every path is still on disk. No DB, no git, no resolver. This is the single biggest speed win and I benchmark it below.

One more principle, installing never builds binaries implicitly. `clue install <pkg>` fetches the source. `--build` compiles its binaries (and its deps) into `~/.clue/bin`, release by default. Building runs the package code, so it stays opt in. I like this a lot.

## Starting a project

```bash
clue init myapp -Y
cd myapp
```

That scaffolds a nimble project non interactively. Then add deps the way you think:

```bash
clue install semver
clue install spry@1.2.0
clue install ssl#master
clue install https://github.com/user/repo
```

Versions, branches, URLs, all fine. Need only the closure without the package itself, `--depsOnly` does that. Need a different registry, `clue source.add myfork https://.../packages.json` then `clue install pkg --source:myfork`, `clue source.fetch` refreshes. Registries older than 24h re fetch automatically before resolving, failures only warn.

When I am hacking on a library itself, I skip install entirely:

```bash
clue develop
```

This links the working tree into `~/.clue/develop` for live library discovery. `import pkg/<name>` resolves against your tree, never copied, never deleted. Uninstalling only removes the entry, never your files. This is my favorite Clue feature and it is not close.

## Build, the command that pays for the lock

Project build, from the nimble file:

```bash
clue build
clue build --release
clue build --features:ssl,jwt
```

Single file, no nimble file needed, every installed package on the import path:

```bash
clue build mymodule.nim
clue build src/meowmail.nim --out:bin/meowmail
```

Unknown flags forward to Nim, so `--passC`, `--passL`, `--mm`, `-d:xxx` all pass through. Backend select with `-b:c|cpp|objc|js`.

Here is the lock effect, measured with hyperfine on a mini fixture (one binary, one dep, `semver`), 5 runs each:

```text
Benchmark 1: clue build (warm, clue.lock hit)
  Time (mean): 1.088 s ± 0.005 s | Range: 1.083 s … 1.094 s

Benchmark 1: clue build (cold, no lock, full resolve)
  Time (mean): 2.654 s ± 0.116 s | Range: 2.486 s … 2.806 s
```

Cold does the full DFS walk, you can watch it with `--verbose` printing each `dep name → path` line, plus the develop shadow notes. Warm prints one line, `using clue.lock (24 packages)` on the real Clue repo, and goes straight to `nim c`. On the mini project that is 2.65s down to 1.09s, about 2.4x, saving roughly 1.5s of pure resolution overhead. On bigger trees the gap grows, resolution is O(tree) while the lock is O(1) validation.

Honest footnote, the warm build above still compiles the mini binary with Nim, so ~1s of that is `nim c` itself. The lock removes the resolver tax, not the compiler.

## Test, serial or parallel

```bash
clue test
clue test "versions, sources"
clue test test_versions --parallel
```

No args runs every `tests/t*.nim`. A filter takes names, filenames, or paths, all normalize to the module name. `--parallel` fans out on a worker pool sized to the CPU and reports one verdict per test as it lands, `Success: <name>`, instead of interleaved compiler chatter. Use it when tests are independent.

If your nimble file defines `task test`, Clue runs that instead (and tells you `--parallel` is ignored, since a custom task owns its scheduling).

Measured on the same mini fixture, one test module, 3 runs:

```text
Benchmark 1: clue test (mini, 1 module)
  Time (mean): 2.292 s ± 0.007 s | Range: 2.284 s … 2.298 s
```

That is compile plus run of a trivial module, dominated by `nim c`. For reference, a single real test module in Clue's own suite (`test_versions`, full assertions over git refs and copy layouts) takes about 6.8s to compile and pass. The win with `--parallel` shows up on multi module suites, two modules I measured finished in 8.4s parallel, where serial pays full compile latency back to back.

## Install and update, cached vs network

Install of an already present package is a no-op plus verification, no network:

```bash
clue install semver
```

```text
Benchmark 1: clue install semver (cached, no-op)
  Time (mean): 1.262 s ± 0.032 s | Range: 1.229 s … 1.292 s
```

Update of a leaf already at latest (`semver@1.2.3`, prints `Already up to date`):

```text
Benchmark 1: clue update semver (already latest)
  Time (mean): 3.136 s ± 0.127 s | Range: 2.989 s … 3.214 s
```

That ~3s is git ls-remote plus version DB work, totally network bound. Bare `clue update` with no args upgrades the current project's deps (with a nimble file present), otherwise everything installed. Add `--verbose` to watch the tree.

Registry reads, always cached after first fetch:

```text
clue versions semver (cached registry): 1.119 s ± 0.006 s, 5 runs
clue dump semver (cached):              1.049 s ± 0.007 s, 5 runs
```

Yes, there is a ~1s floor on everything. That is the Clue binary starting plus opening its local DBs. It is the price of a batteries included Nim binary, and it is why the lock matters, it keeps the per command work after startup near zero.

With `--verbose`, install prints the resolved tree, the thing I actually read when deps fight:

```text
Info: Dependency tree
tim v0.2.8
├─ kapsis v0.4.4
│  ├─ voodoo v0.2.0
│  ├─ valido @head
│  │  ├─ bigints v1.1.0
...
```

## Everyday maintenance

```bash
clue versions semver --refresh
clue dump spry --refresh
clue bump --level:patch
clue bump 1.1.1
clue bump nim 2.2.0
clue prune
clue uninstall spry
```

`bump` edits the version or the constraint in place, no hand editing semver while Usher screams in the background:

```text
clue bump --level:patch
Success: 0.1.9 -> 0.1.10 in clue.nimble
```

`prune` removes orphaned packages. `dump` gives JSON plus git activity, handy in scripts, pipe it through `clue dbcheck "SELECT ..." --json` when you want SQL over the local DB (read only, relax).

## Docs, venvs, tasks, deploys

Docs are local and versioned, built on `nim doc`, served over stdlib HTTP:

```bash
clue docs.gen spry
clue docs.gen spry@1.2.0
clue docs.open spry --port:8080
```

Per version Nim toolchains via choosenim:

```bash
clue venv --nim:2.2.0
source .env/activate
```

Nimscript tasks and quality gates:

```bash
clue task
clue task mytask
clue check
clue check src/clue.nim
clue doctor
```

`check` runs `nim check` with the same resolved paths as build. On Clue's own `src/clue.nim` that took 6.2s here, semantics are not free, but at least the paths are right, which is exactly where raw `nim c` fails with `fatal error: 'xyz.h' file not found` while `clue build` succeeds, because Clue resolves per package compiler config including native C headers.

Deploys, static sites and systemd web targets:

```bash
clue deploy.init
clue deploy.dir --dry-run
clue deploy.web --status
```

See `docs/deploy.md` for the full reference, it deserves its own post.

## Clue vs Nimble at a glance

| Capability | Clue | Nimble |
| --- | :---: | :---: |
| Install / uninstall / prune | ✓ | ✓ |
| Version, branch, URL installs | ✓ | ✓ |
| SSH installs | ✓ | ✓ |
| Cached version discovery | ✓ | partial |
| DFS nearest wins resolution | ✓ | ✗ (SAT) |
| `clue.lock` fast path rebuilds | ✓ | ✗ |
| `develop` editable symlinks | ✓ | ✗ (`develop` differs) |
| Opt-in binary builds (`--build`) | ✓ | ✗ (builds implicitly) |
| Single file build, no nimble file | ✓ | ✗ |
| Forward unknown flags to Nim | ✓ | partial |
| Feature flags (`--features`) | ✓ | ✓ |
| Native C deps on import path | ✓ | partial |
| Parallel test runner | ✓ | ✗ |
| Local versioned docs + serve | ✓ | ✗ |
| Virtual envs (choosenim) | ✓ | ✗ |
| Deploy scaffolding | ✓ | ✗ |
| CI reusable workflows | ✓ | ✓ |

Nimble is the standard and stays installed on my box for compatibility. But day to day I use Clue for everything, installs, builds, tests, docs, deploys. It is my default, not my fallback. Nimble is the one I reach for only when a project demands it.

## Clue in CI

This is also how my GitHub Actions run, through the reusable workflows in [nimbase/setup-nim-action](https://github.com/nimbase/setup-nim-action). The repo ships each test and release workflow in two flavors, and the `*_clue.yml` ones preinstall Clue and run `clue install` and `clue test` and `clue build --release` under the hood. My workflow files end up tiny.

Test on Linux, Windows and macOS:

```yaml
# .github/workflows/test.yml
name: test
on: [push, pull_request]
jobs:
  test:
    uses: nimbase/setup-nim-action/.github/workflows/test_clue.yml@main
    # with:
    #   nim-version: '2.2.10'
    #   os: '[{"os":"ubuntu-latest"},{"os":"windows-latest"}]'
    #   cache: true
```

That one line replaces a 30 line matrix. It installs Nim (prebuilts first, no rate limited API calls), preinstalls Clue, then runs `clue install` and `clue test`. Extra knobs I actually use, `nim-version`, an `os` JSON matrix, `test-flags` forwarded to the compiler (for example `-d:ssl`), `pre-install-command` and `pre-test-command` hooks, and `cache: true` to keep `~/.clue` between runs.

Release binaries per OS and arch, attached to a GitHub release:

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['*.*.*']
jobs:
  release:
    permissions:
      contents: write
    uses: nimbase/setup-nim-action/.github/workflows/release_clue.yml@main
    with:
      app-name: myapp # binary name, built with `clue build --release`
```

Push a tag, get `myapp_<os>-<arch>.tar.gz` archives (`.zip` on Windows) on the release page. The default matrix covers Ubuntu x86_64, macOS arm64 and Intel, and Windows x86_64, all configurable through `target-matrix`. I keep `cache: true` on and `test: true` so releases never ship untested code. There is also a `docs.yml` workflow that generates `nim doc` HTML and deploys it to Pages, and a plain `action.yml` when I just need Nim on `PATH` in a custom job. Full input reference lives in the [action README](https://github.com/nimbase/setup-nim-action).

## Try it where it hurts

Pick the project where Nimble annoys you most and run it side by side:

```bash
clue install
clue build
clue test --parallel
```

Then delete `clue.lock`, build again, and watch the difference. That before and after is the whole pitch. If the cold build confuses you, `--verbose` shows every decision, and if something still looks wrong, [open an issue](https://github.com/openpeeps/clue/issues). I read them, and the resolver logs make them easy to fix.

Links: [Clue on GitHub](https://github.com/openpeeps/clue), [API reference](https://openpeeps.github.io/clue/), [releases](https://github.com/openpeeps/clue/releases/latest). The skill block in the README (`nim-clue`) teaches your LLM assistant to prefer `clue build` and `clue test` over raw `nim c`, which is honestly how I use it most days.
