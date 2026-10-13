// Image decoding to RGBA8 (T091). See mfbe/images.hpp.
#include <mfbe/image_probe.hpp>
#include <mfbe/images.hpp>

#include <algorithm>
#include <csetjmp>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <gif_lib.h>
#include <memory>
#include <mutex>
#include <new>
#include <png.h>
#include <tiffio.h>
#include <webp/decode.h>

// libjpeg needs <cstdio> (FILE) before jpeglib.h.
#include <jpeglib.h>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_BMP
#define STBI_NO_STDIO
#define STBI_NO_LINEAR
#define STBI_NO_HDR
#define STBI_ASSERT(x) ((void)0)
#define STBI_MAX_DIMENSIONS 65536
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wold-style-cast"
#pragma GCC diagnostic ignored "-Wcast-align"
#pragma GCC diagnostic ignored "-Wimplicit-fallthrough"
#pragma GCC diagnostic ignored "-Wdouble-promotion"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-but-set-variable"
#pragma GCC diagnostic ignored "-Wnull-dereference"
#pragma GCC diagnostic ignored "-Wsign-compare"
#endif
#include <stb_image.h>
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

namespace mfbe::images {
namespace {

void check_dimensions(std::int64_t width, std::int64_t height) {
    if (width <= 0 || height <= 0) {
        throw DecodeError("corrupt", "image has no pixels");
    }
    if (width > kMaxDimension || height > kMaxDimension || width * height > kMaxPixels) {
        throw DecodeError("tooLarge", "image exceeds " + std::to_string(kMaxPixels / 1000000) +
                                          " megapixels (" + std::to_string(width) + "x" +
                                          std::to_string(height) + ")");
    }
}

Bitmap make_bitmap(int width, int height, std::string_view type) {
    check_dimensions(width, height);
    Bitmap bitmap;
    bitmap.width = width;
    bitmap.height = height;
    bitmap.source_type = std::string(type);
    bitmap.rgba.resize(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4);
    return bitmap;
}

/* ----------------------------------------------------------------------------------------- */
/* JPEG (libjpeg-turbo)                                                                       */
/* ----------------------------------------------------------------------------------------- */

struct JpegErrorManager {
    jpeg_error_mgr pub;
    std::jmp_buf jump;
    char message[JMSG_LENGTH_MAX];
};

void jpeg_error_exit(j_common_ptr cinfo) {
    auto* err = reinterpret_cast<JpegErrorManager*>(cinfo->err);
    (*cinfo->err->format_message)(cinfo, err->message);
    std::longjmp(err->jump, 1);
}

void jpeg_output_message(j_common_ptr) {}  // silence warnings on stderr

struct JpegState {
    jpeg_decompress_struct cinfo{};
    JpegErrorManager err{};
    Bitmap bitmap;
    std::vector<std::uint8_t> cmyk_row;
    int min_width = 0;
    int min_height = 0;
};

// Runs between setjmp and jpeg_destroy; libjpeg errors longjmp out of here.
void jpeg_decode_body(JpegState& st, std::string_view bytes) {
    jpeg_decompress_struct& cinfo = st.cinfo;
    jpeg_mem_src(&cinfo, reinterpret_cast<const unsigned char*>(bytes.data()),
                 static_cast<unsigned long>(bytes.size()));
    if (jpeg_read_header(&cinfo, TRUE) != JPEG_HEADER_OK) {
        throw DecodeError("corrupt", "JPEG: no image header");
    }
    check_dimensions(cinfo.image_width, cinfo.image_height);
    // DCT scaling for previews: the largest reduction keeping both axes >= the minimum.
    if (st.min_width > 0 && st.min_height > 0) {
        for (int denom = 8; denom >= 2; denom /= 2) {
            const long w = (static_cast<long>(cinfo.image_width) + denom - 1) / denom;
            const long h = (static_cast<long>(cinfo.image_height) + denom - 1) / denom;
            if (w >= st.min_width && h >= st.min_height) {
                cinfo.scale_num = 1;
                cinfo.scale_denom = static_cast<unsigned>(denom);
                break;
            }
        }
    }
    const bool cmyk = cinfo.jpeg_color_space == JCS_CMYK || cinfo.jpeg_color_space == JCS_YCCK;
    cinfo.out_color_space = cmyk ? JCS_CMYK : JCS_EXT_RGBA;
    jpeg_start_decompress(&cinfo);
    st.bitmap = make_bitmap(static_cast<int>(cinfo.output_width),
                            static_cast<int>(cinfo.output_height), "image/jpeg");
    const std::size_t stride = static_cast<std::size_t>(cinfo.output_width) * 4;
    if (cmyk) {
        st.cmyk_row.resize(stride);  // four components per pixel as well
    }
    while (cinfo.output_scanline < cinfo.output_height) {
        std::uint8_t* row =
            st.bitmap.rgba.data() + static_cast<std::size_t>(cinfo.output_scanline) * stride;
        if (cmyk) {
            JSAMPROW rows[1] = {st.cmyk_row.data()};
            jpeg_read_scanlines(&cinfo, rows, 1);
            // Adobe JPEGs store inverted CMYK; RGB = C * K / 255 is the usual approximation.
            for (std::size_t x = 0; x < cinfo.output_width; ++x) {
                const unsigned c = st.cmyk_row[x * 4], m = st.cmyk_row[x * 4 + 1],
                               y = st.cmyk_row[x * 4 + 2], k = st.cmyk_row[x * 4 + 3];
                row[x * 4] = static_cast<std::uint8_t>(c * k / 255);
                row[x * 4 + 1] = static_cast<std::uint8_t>(m * k / 255);
                row[x * 4 + 2] = static_cast<std::uint8_t>(y * k / 255);
                row[x * 4 + 3] = 255;
            }
        } else {
            JSAMPROW rows[1] = {row};
            jpeg_read_scanlines(&cinfo, rows, 1);
        }
    }
    jpeg_finish_decompress(&cinfo);
    st.bitmap.has_alpha = false;
}

Bitmap decode_jpeg(std::string_view bytes, int min_width, int min_height) {
    auto st = std::make_unique<JpegState>();
    st->min_width = min_width;
    st->min_height = min_height;
    st->cinfo.err = jpeg_std_error(&st->err.pub);
    st->err.pub.error_exit = jpeg_error_exit;
    st->err.pub.output_message = jpeg_output_message;
    if (setjmp(st->err.jump)) {
        jpeg_destroy_decompress(&st->cinfo);
        throw DecodeError("corrupt", std::string("JPEG: ") + st->err.message);
    }
    jpeg_create_decompress(&st->cinfo);
    try {
        jpeg_decode_body(*st, bytes);
    } catch (...) {
        jpeg_destroy_decompress(&st->cinfo);
        throw;
    }
    jpeg_destroy_decompress(&st->cinfo);
    return std::move(st->bitmap);
}

/* ----------------------------------------------------------------------------------------- */
/* PNG (libpng)                                                                               */
/* ----------------------------------------------------------------------------------------- */

struct PngState {
    std::string_view data;
    std::size_t pos = 0;
    std::string error;
    Bitmap bitmap;
    std::vector<png_bytep> rows;
};

void png_read_from_memory(png_structp png, png_bytep out, png_size_t length) {
    auto* st = static_cast<PngState*>(png_get_io_ptr(png));
    if (st->pos + length > st->data.size()) {
        png_error(png, "unexpected end of PNG data");
    }
    std::memcpy(out, st->data.data() + st->pos, length);
    st->pos += length;
}

void png_on_error(png_structp png, png_const_charp message) {
    auto* st = static_cast<PngState*>(png_get_error_ptr(png));
    if (st != nullptr) {
        st->error = message == nullptr ? "PNG error" : message;
    }
    png_longjmp(png, 1);
}

void png_on_warning(png_structp, png_const_charp) {}

void png_decode_body(PngState& st, png_structp png, png_infop info) {
    png_set_read_fn(png, &st, png_read_from_memory);
    png_set_user_limits(png, kMaxDimension, kMaxDimension);
    png_read_info(png, info);
    const png_uint_32 width = png_get_image_width(png, info);
    const png_uint_32 height = png_get_image_height(png, info);
    const int color_type = png_get_color_type(png, info);
    const int bit_depth = png_get_bit_depth(png, info);
    check_dimensions(width, height);
    if (color_type == PNG_COLOR_TYPE_PALETTE) {
        png_set_palette_to_rgb(png);
    }
    if (color_type == PNG_COLOR_TYPE_GRAY && bit_depth < 8) {
        png_set_expand_gray_1_2_4_to_8(png);
    }
    if (png_get_valid(png, info, PNG_INFO_tRNS) != 0) {
        png_set_tRNS_to_alpha(png);
    }
    if (bit_depth == 16) {
        png_set_strip_16(png);
    }
    if (color_type == PNG_COLOR_TYPE_GRAY || color_type == PNG_COLOR_TYPE_GRAY_ALPHA) {
        png_set_gray_to_rgb(png);
    }
    png_set_filler(png, 0xFF, PNG_FILLER_AFTER);
    png_set_interlace_handling(png);
    png_read_update_info(png, info);
    if (png_get_rowbytes(png, info) != static_cast<std::size_t>(width) * 4) {
        throw DecodeError("corrupt", "PNG: unexpected row layout");
    }
    st.bitmap = make_bitmap(static_cast<int>(width), static_cast<int>(height), "image/png");
    st.rows.resize(height);
    for (png_uint_32 y = 0; y < height; ++y) {
        st.rows[y] = st.bitmap.rgba.data() + static_cast<std::size_t>(y) * width * 4;
    }
    png_read_image(png, st.rows.data());
    png_read_end(png, nullptr);
    st.bitmap.update_alpha_flag();
}

Bitmap decode_png(std::string_view bytes) {
    auto st = std::make_unique<PngState>();
    st->data = bytes;
    png_structp png =
        png_create_read_struct(PNG_LIBPNG_VER_STRING, st.get(), png_on_error, png_on_warning);
    if (png == nullptr) {
        throw DecodeError("corrupt", "PNG: cannot create reader");
    }
    png_infop info = png_create_info_struct(png);
    if (info == nullptr) {
        png_destroy_read_struct(&png, nullptr, nullptr);
        throw DecodeError("corrupt", "PNG: cannot create info");
    }
    if (setjmp(png_jmpbuf(png))) {
        png_destroy_read_struct(&png, &info, nullptr);
        throw DecodeError("corrupt", "PNG: " + st->error);
    }
    try {
        png_decode_body(*st, png, info);
    } catch (...) {
        png_destroy_read_struct(&png, &info, nullptr);
        throw;
    }
    png_destroy_read_struct(&png, &info, nullptr);
    return std::move(st->bitmap);
}

/* ----------------------------------------------------------------------------------------- */
/* GIF (giflib) - first frame                                                                 */
/* ----------------------------------------------------------------------------------------- */

struct GifReader {
    std::string_view data;
    std::size_t pos = 0;
};

int gif_read_from_memory(GifFileType* gif, GifByteType* out, int length) {
    auto* reader = static_cast<GifReader*>(gif->UserData);
    const std::size_t want = static_cast<std::size_t>(std::max(length, 0));
    const std::size_t have = std::min(want, reader->data.size() - reader->pos);
    std::memcpy(out, reader->data.data() + reader->pos, have);
    reader->pos += have;
    return static_cast<int>(have);
}

Bitmap decode_gif(std::string_view bytes) {
    GifReader reader{bytes, 0};
    int error = 0;
    GifFileType* gif = DGifOpen(&reader, gif_read_from_memory, &error);
    if (gif == nullptr) {
        throw DecodeError("corrupt", std::string("GIF: ") + GifErrorString(error));
    }
    struct Closer {
        GifFileType* g;
        ~Closer() { DGifCloseFile(g, nullptr); }
    } closer{gif};
    check_dimensions(gif->SWidth, gif->SHeight);
    if (DGifSlurp(gif) != GIF_OK || gif->ImageCount < 1) {
        throw DecodeError("corrupt", std::string("GIF: ") + GifErrorString(gif->Error));
    }
    const SavedImage& frame = gif->SavedImages[0];
    const GifImageDesc& desc = frame.ImageDesc;
    const ColorMapObject* map = desc.ColorMap != nullptr ? desc.ColorMap : gif->SColorMap;
    if (map == nullptr || frame.RasterBits == nullptr) {
        throw DecodeError("corrupt", "GIF: frame without colour map");
    }
    if (desc.Width <= 0 || desc.Height <= 0) {
        throw DecodeError("corrupt", "GIF: empty frame");
    }
    int transparent = -1;
    GraphicsControlBlock gcb;
    if (DGifSavedExtensionToGCB(gif, 0, &gcb) == GIF_OK) {
        transparent = gcb.TransparentColor;
    }
    Bitmap bitmap = make_bitmap(gif->SWidth, gif->SHeight, "image/gif");
    std::fill(bitmap.rgba.begin(), bitmap.rgba.end(), 0);  // transparent canvas
    // Interlaced frames are stored in four passes.
    std::vector<int> row_order(static_cast<std::size_t>(desc.Height));
    if (desc.Interlace) {
        const int starts[4] = {0, 4, 2, 1};
        const int steps[4] = {8, 8, 4, 2};
        std::size_t n = 0;
        for (int pass = 0; pass < 4; ++pass) {
            for (int y = starts[pass]; y < desc.Height; y += steps[pass]) {
                row_order[n++] = y;
            }
        }
    } else {
        for (int y = 0; y < desc.Height; ++y) {
            row_order[static_cast<std::size_t>(y)] = y;
        }
    }
    for (int stored = 0; stored < desc.Height; ++stored) {
        const int canvas_y = desc.Top + row_order[static_cast<std::size_t>(stored)];
        if (canvas_y < 0 || canvas_y >= gif->SHeight) {
            continue;
        }
        const GifByteType* src = frame.RasterBits + static_cast<std::size_t>(stored) *
                                                        static_cast<std::size_t>(desc.Width);
        for (int x = 0; x < desc.Width; ++x) {
            const int canvas_x = desc.Left + x;
            if (canvas_x < 0 || canvas_x >= gif->SWidth) {
                continue;
            }
            const int index = src[x];
            if (index == transparent || index >= map->ColorCount) {
                continue;
            }
            const GifColorType& c = map->Colors[index];
            std::uint8_t* dst = bitmap.rgba.data() + (static_cast<std::size_t>(canvas_y) *
                                                          static_cast<std::size_t>(gif->SWidth) +
                                                      static_cast<std::size_t>(canvas_x)) *
                                                         4;
            dst[0] = c.Red;
            dst[1] = c.Green;
            dst[2] = c.Blue;
            dst[3] = 255;
        }
    }
    bitmap.update_alpha_flag();
    return bitmap;
}

/* ----------------------------------------------------------------------------------------- */
/* BMP (stb_image)                                                                            */
/* ----------------------------------------------------------------------------------------- */

Bitmap decode_bmp(std::string_view bytes) {
    int width = 0, height = 0, channels = 0;
    if (!stbi_info_from_memory(reinterpret_cast<const stbi_uc*>(bytes.data()),
                               static_cast<int>(bytes.size()), &width, &height, &channels)) {
        throw DecodeError("corrupt", std::string("BMP: ") + stbi_failure_reason());
    }
    // stbi_info reports a negative height for top-down bitmaps; stbi_load normalises it.
    check_dimensions(width, height < 0 ? -static_cast<std::int64_t>(height) : height);
    stbi_uc* pixels =
        stbi_load_from_memory(reinterpret_cast<const stbi_uc*>(bytes.data()),
                              static_cast<int>(bytes.size()), &width, &height, &channels, 4);
    if (pixels == nullptr) {
        throw DecodeError("corrupt", std::string("BMP: ") + stbi_failure_reason());
    }
    Bitmap bitmap = make_bitmap(width, height, "image/bmp");
    std::memcpy(bitmap.rgba.data(), pixels, bitmap.rgba.size());
    stbi_image_free(pixels);
    bitmap.update_alpha_flag();
    return bitmap;
}

/* ----------------------------------------------------------------------------------------- */
/* WebP (libwebp)                                                                             */
/* ----------------------------------------------------------------------------------------- */

Bitmap decode_webp(std::string_view bytes) {
    WebPBitstreamFeatures features;
    if (WebPGetFeatures(reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size(),
                        &features) != VP8_STATUS_OK) {
        throw DecodeError("corrupt", "WebP: invalid bitstream");
    }
    check_dimensions(features.width, features.height);
    Bitmap bitmap = make_bitmap(features.width, features.height, "image/webp");
    if (WebPDecodeRGBAInto(reinterpret_cast<const std::uint8_t*>(bytes.data()), bytes.size(),
                           bitmap.rgba.data(), bitmap.rgba.size(), features.width * 4) == nullptr) {
        throw DecodeError("corrupt", "WebP: decode failed");
    }
    bitmap.update_alpha_flag();
    return bitmap;
}

/* ----------------------------------------------------------------------------------------- */
/* TIFF (libtiff)                                                                             */
/* ----------------------------------------------------------------------------------------- */

struct TiffReader {
    std::string_view data;
    toff_t pos = 0;
};

tmsize_t tiff_read(thandle_t handle, void* out, tmsize_t size) {
    auto* reader = static_cast<TiffReader*>(handle);
    if (reader->pos >= reader->data.size()) {
        return 0;
    }
    const auto have =
        std::min<std::size_t>(static_cast<std::size_t>(size),
                              reader->data.size() - static_cast<std::size_t>(reader->pos));
    std::memcpy(out, reader->data.data() + reader->pos, have);
    reader->pos += have;
    return static_cast<tmsize_t>(have);
}

tmsize_t tiff_write(thandle_t, void*, tmsize_t) {
    return 0;
}

toff_t tiff_seek(thandle_t handle, toff_t offset, int whence) {
    auto* reader = static_cast<TiffReader*>(handle);
    toff_t base = 0;
    if (whence == SEEK_CUR) {
        base = reader->pos;
    } else if (whence == SEEK_END) {
        base = reader->data.size();
    }
    reader->pos = std::min<toff_t>(base + offset, reader->data.size());
    return reader->pos;
}

int tiff_close(thandle_t) {
    return 0;
}

toff_t tiff_size(thandle_t handle) {
    return static_cast<TiffReader*>(handle)->data.size();
}

int tiff_map(thandle_t, void**, toff_t*) {
    return 0;
}

void tiff_unmap(thandle_t, void*, toff_t) {}

void tiff_silence(const char*, const char*, va_list) {}

void silence_libtiff() {
    static std::once_flag once;
    std::call_once(once, [] {
        TIFFSetErrorHandler(tiff_silence);
        TIFFSetWarningHandler(tiff_silence);
    });
}

Bitmap decode_tiff(std::string_view bytes) {
    silence_libtiff();
    TiffReader reader{bytes, 0};
    TIFF* tiff = TIFFClientOpen("memory", "rm", &reader, tiff_read, tiff_write, tiff_seek,
                                tiff_close, tiff_size, tiff_map, tiff_unmap);
    if (tiff == nullptr) {
        throw DecodeError("corrupt", "TIFF: cannot open");
    }
    struct Closer {
        TIFF* t;
        ~Closer() { TIFFClose(t); }
    } closer{tiff};
    std::uint32_t width = 0, height = 0;
    if (TIFFGetField(tiff, TIFFTAG_IMAGEWIDTH, &width) != 1 ||
        TIFFGetField(tiff, TIFFTAG_IMAGELENGTH, &height) != 1) {
        throw DecodeError("corrupt", "TIFF: missing dimensions");
    }
    check_dimensions(width, height);
    Bitmap bitmap = make_bitmap(static_cast<int>(width), static_cast<int>(height), "image/tiff");
    // Packed ABGR words (R in the low byte): RGBA byte order in memory on little-endian hosts.
    std::vector<std::uint32_t> raster(bitmap.pixel_count());
    if (TIFFReadRGBAImageOriented(tiff, width, height, raster.data(), ORIENTATION_TOPLEFT, 1) !=
        1) {
        throw DecodeError("corrupt", "TIFF: decode failed");
    }
    for (std::size_t i = 0; i < raster.size(); ++i) {
        const std::uint32_t p = raster[i];
        bitmap.rgba[i * 4] = static_cast<std::uint8_t>(TIFFGetR(p));
        bitmap.rgba[i * 4 + 1] = static_cast<std::uint8_t>(TIFFGetG(p));
        bitmap.rgba[i * 4 + 2] = static_cast<std::uint8_t>(TIFFGetB(p));
        bitmap.rgba[i * 4 + 3] = static_cast<std::uint8_t>(TIFFGetA(p));
    }
    bitmap.update_alpha_flag();
    return bitmap;
}

Bitmap decode_impl(std::string_view bytes, int min_width, int min_height) {
    const Probe header = probe(bytes);
    const std::string& type = header.contentType;
    if (header.width && header.height) {
        check_dimensions(*header.width, *header.height);  // refuse before touching the codec
    }
    if (type == "image/jpeg") {
        return decode_jpeg(bytes, min_width, min_height);
    }
    if (type == "image/png") {
        return decode_png(bytes);
    }
    if (type == "image/gif") {
        return decode_gif(bytes);
    }
    if (type == "image/bmp") {
        return decode_bmp(bytes);
    }
    if (type == "image/webp") {
        return decode_webp(bytes);
    }
    if (type == "image/tiff") {
        return decode_tiff(bytes);
    }
    throw DecodeError("unsupported",
                      type.empty() ? "not a recognised image format" : "no decoder for " + type);
}

}  // namespace

void Bitmap::update_alpha_flag() {
    has_alpha = false;
    for (std::size_t i = 3; i < rgba.size(); i += 4) {
        if (rgba[i] != 255) {
            has_alpha = true;
            return;
        }
    }
}

Bitmap decode(std::string_view bytes) {
    return decode_impl(bytes, 0, 0);
}

Bitmap decode_for_preview(std::string_view bytes, int min_width, int min_height) {
    return decode_impl(bytes, min_width, min_height);
}

std::optional<Bitmap> try_decode(std::string_view bytes, std::string* error) {
    try {
        return decode(bytes);
    } catch (const DecodeError& e) {
        if (error != nullptr) {
            *error = e.what();
        }
        return std::nullopt;
    } catch (const std::bad_alloc&) {
        if (error != nullptr) {
            *error = "tooLarge: out of memory";
        }
        return std::nullopt;
    }
}

}  // namespace mfbe::images
