# Licences compiled into the STEP reader

This developer note is not copied into the production build. The notice that ships is `public/THIRD_PARTY_NOTICES.txt` (the production build copies `public/` into the site output).

## The exception this module is

The repository rule is no GPL, AGPL, or LGPL dependency ([AGENTS.md](../../AGENTS.md)). Artur granted one exception on 2026-11-06: Open CASCADE Technology, as a separate WebAssembly module, for STEP import in the browser. The exception covers this package and nothing else. It does not cover an OCCT npm package, OCCT linked into another wasm, or any other LGPL library.

OCCT is LGPL-2.1-only with the Open CASCADE exception 1.0. That exception lets object code include material from OCCT headers under other terms. It does not remove section 6 of the LGPL: a person who receives the library must be able to get its source and run the application with a modified version of it.

## How the module meets the LGPL

| Requirement | How |
| --- | --- |
| Notice that OCCT is used, and the licence text | `public/THIRD_PARTY_NOTICES.txt` says so in its introduction and carries the LGPL-2.1 and the exception in full. |
| Source of the library | The upstream tag `V8_0_1` (`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`), compiled without patches. The build script refuses a checkout that is another commit or has local changes. |
| Source of the work that is linked with it | The wrapper `src/api.cpp` is in this repository, which is public, under the same terms as OCCT. It is the only application code in the wasm. |
| Build scripts | `CMakeLists.txt` here and `scripts/step/build-step-wasm.mjs`. CI rebuilds the committed wasm byte for byte. |
| Running the application with a modified library | The module is a separate file behind a five-function interface (`surfcad_step_abi`, `surfcad_step_mesh`, `surfcad_step_free`, `malloc`, `free`). A rebuilt `surfcad_step.wasm` can be served in its place, or the application can be built from this repository with it. The shipped notice says how. |

The build script enforces the separation. It fails if `compile_commands.json` compiles a file outside the OCCT checkout other than `src/api.cpp`, or if the link line names an archive other than `libocct.a`.

Do not import application code into `src/api.cpp`, and do not link OCCT into `packages/surfcad-mesh`, `packages/surfcad-fea`, or the JavaScript bundle. Either would put application code under the LGPL's relinking terms or OCCT outside the replaceable file.

This is the engineering side of compliance. It is not legal advice.

## Shipped

| Component | Pin | Licence |
| --- | --- | --- |
| Open CASCADE Technology | `V8_0_1` (`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`) | LGPL-2.1-only WITH OCCT-exception-1.0 |
| `src/api.cpp` (wrapper) | this repository | LGPL-2.1-only WITH OCCT-exception-1.0 |
| DELABELLA, inside OCCT (`BRepMesh/delabella.cpp`) | OCCT tag | MIT |
| strtod by David M. Gay, inside OCCT (`Standard/Standard_Strtod.cxx`) | OCCT tag | Lucent permission notice |
| Unicode conversion code, inside OCCT (`NCollection/NCollection_UtfIterator.lxx`) | OCCT tag | Unicode, Inc. notice |
| `FlexLexer.h`, inside OCCT | OCCT tag | BSD (Regents of the University of California) |
| Bison parser skeleton, inside OCCT (`StepFile/step.tab.cxx`) | OCCT tag | GPL-3.0-or-later with the Bison skeleton exception, used under that exception |
| Emscripten runtime, musl, libc++, libc++abi, libunwind, compiler-rt | emsdk 6.0.12 | MIT, NCSA, Apache-2.0 WITH LLVM-exception |

The Bison skeleton's special exception lets a work that contains the skeleton be distributed under terms of its own choice. OCCT uses it that way and so does this module. The GPL does not apply to that use.

The licence texts in the shipped notice are snapshots in `scripts/ci/license-texts/step/`, taken from the files at the pinned tag.

## Compiled toolkits

TKernel, TKMath, TKG2d, TKG3d, TKGeomBase, TKBRep, TKGeomAlgo, TKTopAlgo, TKShHealing, TKMesh, TKXSBase, TKDE, TKDESTEP.

## Not compiled

| Component | Why |
| --- | --- |
| TKCDF, TKLCAF, TKCAF, TKVCAF, TKXCAF (document framework) | The wrapper reads with `STEPControl_Reader`. Headers only. |
| TKService, TKV3d (visualization) | Headers only. |
| `STEPCAFControl`, `DESTEP_Provider.cxx`, `DESTEP_ConfigurationNode.cxx`, `TKDESTEP.cxx` | They need the document framework at link time. |
| TBB, FreeType, FreeImage, RapidJSON, Draco, and every other optional OCCT dependency | Not enabled. The module links no library besides the OCCT archive and the Emscripten runtime. |
