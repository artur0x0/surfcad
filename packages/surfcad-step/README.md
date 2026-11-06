# surfcad-step

STEP bytes in, one triangle soup out. This is Open CASCADE Technology's STEP reader and surface mesher, compiled to WebAssembly so a STEP file is converted on the user's device and is never uploaded.

`src/step/stepMesh.js` loads the module and decodes its result. `src/step/stepClient.js` runs it in a worker (`src/workers/stepWorker.js`). `importStepFile` in `src/utils/importModel.js` hands the soup to the Manifold worker, which welds it into a solid.

## Why this is a separate module

OCCT is LGPL-2.1 with the Open CASCADE exception. [AGENTS.md](../../AGENTS.md) allows it in this one place and nowhere else. The module is its own wasm file, fetched by URL when a STEP file is imported. It holds OCCT and the wrapper in `src/api.cpp`, and no other application code. Nothing else in the app links OCCT. [LICENSES.md](LICENSES.md) has the terms and what the build checks.

The module is single-threaded and does not allocate a `SharedArrayBuffer`, so the page needs no COOP/COEP headers. It is not part of the initial page bundle.

## What it does

The steps match the server converter it replaced (`STEPCAFControl_Reader`, `BRepMesh_IncrementalMesh`, `RWObj_CafWriter`):

1. Read the file from memory with `STEPControl_Reader::ReadStream`. There is no filesystem.
2. Transfer every root and take the compound.
3. Mesh with an absolute linear deflection (default 0.1 mm) and an angular deflection (0.5 rad).
4. Write each face's triangles with the face location applied. A reversed face, or a mirroring location, flips the winding.

Lengths are millimetres: OCCT converts the file's unit. Faces do not share vertices in the output. Names, colours, and the assembly tree are not returned; an assembly comes back as one soup with every body in place.

## API

```js
import { meshStep } from './src/step/stepMesh.js';

const { vertProperties, triVerts, solids, faces, facesWithoutMesh, heapBytes } =
  await meshStep(bytes, { deflection: 0.1 });
```

`bytes` is a `Uint8Array` of the STEP file. `vertProperties` is a `Float32Array` of xyz and `triVerts` a `Uint32Array` of three indices per triangle. `maxTriangles` defaults to 800,000, the cap the server converter had. A failure throws `StepImportError`; its `message` is written for the user and its `code` is `unreadable`, `empty`, `too_detailed`, `out_of_memory`, `timeout`, or `failed`.

The C interface is in the header comment of `surfcad_step_mesh` in `src/api.cpp`: the exported functions, the status codes, and the layout of the result blob. `surfcad_step_abi` returns the interface version (`1`). `stepMesh.js` refuses a module that returns a different value.

## Build

```sh
npm run step:build
```

That runs `scripts/step/build-step-wasm.mjs`. Pins: Emscripten 6.0.12 and OCCT `V8_0_1` (`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`), compiled without patches. `SOURCE_DATE_EPOCH=0` and `-ffile-prefix-map` keep the wasm bytes stable. CI rebuilds into a scratch directory (`scripts/step/check-step-wasm-fresh.mjs`) and fails if `packages/surfcad-step/pkg` differs. The committed files were built on an arm64 host; CI rebuilds them on x86-64.

`CMakeLists.txt` does not use OCCT's own CMake project. It compiles the sources of thirteen toolkits into one static archive and the linker keeps the objects the wrapper reaches. The document framework (XCAF) and the visualization toolkits lend headers and are not compiled, so a call into them fails the link.

A clean build compiles about 3,400 files: roughly ten minutes on 20 cores. The checkout and the objects live in `.deps/` and `build-wasm/` (ignored by git and by the Vite watcher).

## Size and speed

Measured with the committed module (Emscripten 6.0.12, `-O3`, wasm exceptions, no shared memory), Node 22 on an arm64 host:

| | |
| --- | --- |
| `surfcad_step.wasm` | 9,500,788 bytes |
| gzip (`gzip -c -n`) | 3,318,864 bytes |
| glue `surfcad_step.js` | 19,167 bytes |

| File | Size | Convert time | wasm heap after |
| --- | --- | --- | --- |
| single parts (24 files) | 16 to 333 kB | 6 to 63 ms | 64 MiB |
| OCCT `linkrods.step` | 1.8 MB | 0.27 s | 64 MiB |
| board assembly, 161 bodies | 7.1 MB | 2.5 s | 571 MiB |

The native converter took 2.6 s on the board assembly. All 28 files gave the same bounding box as the native converter and a volume within 0.003%.

The heap maximum is 4 GiB. The worker is terminated after each file, which returns the heap to the browser.
