// SPDX-License-Identifier: LGPL-2.1-only WITH OCCT-exception-1.0
// Copyright (c) 2026 the SurfCAD authors
//
// C ABI around Open CASCADE Technology's STEP reader and surface mesher.
//
// STEP bytes in, one triangle soup out. The steps match the server converter
// this module replaces (STEPCAFControl_Reader, BRepMesh_IncrementalMesh,
// RWObj_CafWriter): read the file, transfer every root, mesh with an absolute
// linear deflection and an angular deflection, and write each face's
// triangles with the face location applied. Faces do not share vertices in
// the output. The JavaScript caller welds them and builds the solid.
//
// The module is single-threaded and has no filesystem. The file is read from
// memory. It is its own wasm file so it can be rebuilt or replaced without
// touching the rest of the app. See ../LICENSES.md.

#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <IMeshTools_Parameters.hxx>
#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPControl_Reader.hxx>
#include <Standard_Failure.hxx>
#include <Standard_Version.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <iostream>
#include <istream>
#include <new>
#include <streambuf>
#include <string>
#include <vector>

namespace {

// Bump when the exported functions or the blob layout change.
constexpr uint32_t kAbi = 1;

enum Status : int32_t {
    kOk = 0,
    kBadInput = 1,
    kReadFailed = 2,
    kNoShape = 3,
    kNoTriangles = 4,
    kTooManyTriangles = 5,
    kOutOfMemory = 6,
    kInternal = 7,
};

struct NullBuf : std::streambuf {
    int overflow(int character) override
    {
        return character;
    }
};

struct SilenceStreams {
    NullBuf buffer;
    std::streambuf* cout_buf;
    std::streambuf* cerr_buf;

    SilenceStreams()
        : cout_buf(std::cout.rdbuf(&buffer))
        , cerr_buf(std::cerr.rdbuf(&buffer))
    {
    }

    ~SilenceStreams()
    {
        std::cout.rdbuf(cout_buf);
        std::cerr.rdbuf(cerr_buf);
    }
};

// Read-only stream over the caller's bytes. The STEP lexer only reads
// forward, but seeking is implemented so tellg/seekg behave.
struct MemoryBuf : std::streambuf {
    MemoryBuf(const uint8_t* data, size_t size)
    {
        char* begin = const_cast<char*>(reinterpret_cast<const char*>(data));
        setg(begin, begin, begin + size);
    }

    pos_type seekoff(off_type offset, std::ios_base::seekdir direction, std::ios_base::openmode which) override
    {
        if ((which & std::ios_base::in) == 0) {
            return pos_type(off_type(-1));
        }
        char* target = nullptr;
        if (direction == std::ios_base::beg) {
            target = eback() + offset;
        } else if (direction == std::ios_base::cur) {
            target = gptr() + offset;
        } else {
            target = egptr() + offset;
        }
        if (target < eback() || target > egptr()) {
            return pos_type(off_type(-1));
        }
        setg(eback(), target, egptr());
        return pos_type(target - eback());
    }

    pos_type seekpos(pos_type position, std::ios_base::openmode which) override
    {
        return seekoff(off_type(position), std::ios_base::beg, which);
    }
};

void silence_occt()
{
    static bool done = false;
    if (done) {
        return;
    }
    Message::DefaultMessenger()->ChangePrinters().Clear();
    done = true;
}

void append_bytes(std::vector<uint8_t>& out, const void* data, size_t size)
{
    const auto* bytes = static_cast<const uint8_t*>(data);
    out.insert(out.end(), bytes, bytes + size);
}

void append_u32(std::vector<uint8_t>& out, uint32_t value)
{
    append_bytes(out, &value, sizeof(value));
}

void append_i32(std::vector<uint8_t>& out, int32_t value)
{
    append_bytes(out, &value, sizeof(value));
}

struct Counts {
    uint32_t solids = 0;
    uint32_t faces = 0;
    uint32_t faces_without_mesh = 0;
};

std::vector<uint8_t> pack_blob(
    int32_t status,
    const std::string& message,
    const Counts& counts,
    const std::vector<float>& positions,
    const std::vector<uint32_t>& indices)
{
    std::vector<uint8_t> out;
    out.reserve(40 + message.size() + positions.size() * sizeof(float) + indices.size() * sizeof(uint32_t));
    append_i32(out, status);
    append_u32(out, static_cast<uint32_t>(positions.size() / 3));
    append_u32(out, static_cast<uint32_t>(indices.size() / 3));
    append_u32(out, static_cast<uint32_t>(message.size()));
    append_u32(out, counts.solids);
    append_u32(out, counts.faces);
    append_u32(out, counts.faces_without_mesh);
    append_u32(out, 0);
    append_bytes(out, message.data(), message.size());
    while ((out.size() & 7U) != 0U) {
        out.push_back(0);
    }
    if (!positions.empty()) {
        append_bytes(out, positions.data(), positions.size() * sizeof(float));
    }
    if (!indices.empty()) {
        append_bytes(out, indices.data(), indices.size() * sizeof(uint32_t));
    }
    return out;
}

std::vector<uint8_t> failure(int32_t status, const std::string& message)
{
    return pack_blob(status, message, Counts(), {}, {});
}

uint8_t* publish(const std::vector<uint8_t>& blob, uint32_t* out_bytes)
{
    auto* memory = static_cast<uint8_t*>(std::malloc(blob.size()));
    if (memory == nullptr) {
        return nullptr;
    }
    std::memcpy(memory, blob.data(), blob.size());
    if (out_bytes != nullptr) {
        *out_bytes = static_cast<uint32_t>(blob.size());
    }
    return memory;
}

std::vector<uint8_t> mesh_step(
    const uint8_t* data,
    uint32_t size,
    double linear_deflection,
    double angular_deflection,
    uint32_t max_triangles)
{
    if (data == nullptr || size == 0) {
        return failure(kBadInput, "the STEP file is empty");
    }
    if (!(linear_deflection > 0.0) || !std::isfinite(linear_deflection)
        || !(angular_deflection > 0.0) || !std::isfinite(angular_deflection)) {
        return failure(kBadInput, "linear and angular deflection must be finite and positive");
    }

    silence_occt();
    SilenceStreams silence;

    MemoryBuf buffer(data, size);
    std::istream stream(&buffer);

    STEPControl_Reader reader;
    if (reader.ReadStream("upload.step", stream) != IFSelect_RetDone) {
        return failure(kReadFailed, "the file could not be read as STEP");
    }
    reader.TransferRoots();
    const TopoDS_Shape shape = reader.OneShape();
    if (shape.IsNull()) {
        return failure(kNoShape, "the STEP file has no geometry");
    }

    IMeshTools_Parameters params;
    params.Deflection = linear_deflection;
    params.Angle = angular_deflection;
    params.InParallel = false;
    BRepMesh_IncrementalMesh mesher(shape, params);
    (void)mesher;

    Counts counts;
    for (TopExp_Explorer solids(shape, TopAbs_SOLID); solids.More(); solids.Next()) {
        counts.solids += 1;
    }

    std::vector<float> positions;
    std::vector<uint32_t> indices;
    for (TopExp_Explorer faces(shape, TopAbs_FACE); faces.More(); faces.Next()) {
        counts.faces += 1;
        const TopoDS_Face& face = TopoDS::Face(faces.Current());
        TopLoc_Location location;
        const Handle(Poly_Triangulation) triangulation = BRep_Tool::Triangulation(face, location);
        if (triangulation.IsNull() || triangulation->NbTriangles() == 0) {
            counts.faces_without_mesh += 1;
            continue;
        }
        const int n_nodes = triangulation->NbNodes();
        const int n_triangles = triangulation->NbTriangles();
        if (max_triangles > 0 && indices.size() / 3 + static_cast<size_t>(n_triangles) > max_triangles) {
            return pack_blob(kTooManyTriangles, "the mesh has too many triangles", counts, {}, {});
        }

        const gp_Trsf transform = location.Transformation();
        const bool identity = location.IsIdentity();
        // A mirroring location turns the triangles inside out, the same as a
        // reversed face. The two cancel.
        const bool mirrored = !identity && transform.VectorialPart().Determinant() < 0.0;
        const bool flip = (face.Orientation() == TopAbs_REVERSED) != mirrored;

        const uint32_t base = static_cast<uint32_t>(positions.size() / 3);
        positions.reserve(positions.size() + static_cast<size_t>(n_nodes) * 3);
        for (int i = 1; i <= n_nodes; ++i) {
            gp_Pnt point = triangulation->Node(i);
            if (!identity) {
                point.Transform(transform);
            }
            if (!std::isfinite(point.X()) || !std::isfinite(point.Y()) || !std::isfinite(point.Z())) {
                return failure(kInternal, "the mesh has a non-finite coordinate");
            }
            positions.push_back(static_cast<float>(point.X()));
            positions.push_back(static_cast<float>(point.Y()));
            positions.push_back(static_cast<float>(point.Z()));
        }
        indices.reserve(indices.size() + static_cast<size_t>(n_triangles) * 3);
        for (int i = 1; i <= n_triangles; ++i) {
            int a = 0;
            int b = 0;
            int c = 0;
            triangulation->Triangle(i).Get(a, b, c);
            if (a < 1 || b < 1 || c < 1 || a > n_nodes || b > n_nodes || c > n_nodes) {
                return failure(kInternal, "a triangle references a node outside its face");
            }
            if (flip) {
                const int swap = b;
                b = c;
                c = swap;
            }
            indices.push_back(base + static_cast<uint32_t>(a - 1));
            indices.push_back(base + static_cast<uint32_t>(b - 1));
            indices.push_back(base + static_cast<uint32_t>(c - 1));
        }
    }

    if (indices.empty()) {
        return pack_blob(kNoTriangles, "the STEP file did not produce a mesh", counts, {}, {});
    }
    return pack_blob(kOk, "", counts, positions, indices);
}

}  // namespace

extern "C" {

// Version of this interface. A replacement module must return the same value.
uint32_t surfcad_step_abi()
{
    return kAbi;
}

// Reads `size` bytes of STEP at `data` and meshes every shape in the file.
//
// linear_deflection is the chord tolerance in millimetres (OCCT converts the
// file's length unit to millimetres). angular_deflection is in radians.
// max_triangles 0 means no cap.
//
// Returns a malloc'd little-endian blob, or null when that allocation fails.
// Free it with surfcad_step_free.
//
//   int32  status            0 ok, 1 bad input, 2 not readable as STEP,
//                            3 no geometry, 4 no triangles,
//                            5 over max_triangles, 6 out of memory, 7 internal
//   uint32 nVertices
//   uint32 nTriangles
//   uint32 messageLen
//   uint32 nSolids
//   uint32 nFaces
//   uint32 nFacesWithoutMesh
//   uint32 reserved (0)
//   char   message[messageLen], padded to 8 bytes
//   float  positions[nVertices * 3]
//   uint32 indices[nTriangles * 3]
uint8_t* surfcad_step_mesh(
    const uint8_t* data,
    uint32_t size,
    double linear_deflection,
    double angular_deflection,
    uint32_t max_triangles,
    uint32_t* out_bytes)
{
    if (out_bytes != nullptr) {
        *out_bytes = 0;
    }
    try {
        return publish(mesh_step(data, size, linear_deflection, angular_deflection, max_triangles), out_bytes);
    } catch (const std::bad_alloc&) {
        return publish(failure(kOutOfMemory, "the STEP file needs more memory than the browser allows"), out_bytes);
    } catch (const Standard_Failure& error) {
        const char* text = error.what();
        const std::string name = error.ExceptionType();
        if (name == "Standard_OutOfMemory") {
            return publish(failure(kOutOfMemory, "the STEP file needs more memory than the browser allows"), out_bytes);
        }
        return publish(failure(kInternal, name + (text != nullptr && text[0] != 0 ? std::string(": ") + text : std::string())), out_bytes);
    } catch (const std::exception& error) {
        return publish(failure(kInternal, error.what()), out_bytes);
    } catch (...) {
        return publish(failure(kInternal, "unknown Open CASCADE failure"), out_bytes);
    }
}

void surfcad_step_free(uint8_t* blob)
{
    std::free(blob);
}

}  // extern "C"

int main()
{
    return 0;
}
