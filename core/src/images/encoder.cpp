// JPEG/PNG encoding (T091). See mfbe/images.hpp.
#include <mfbe/images.hpp>

#include <algorithm>
#include <csetjmp>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <jpeglib.h>
#include <memory>
#include <png.h>

namespace mfbe::images {
namespace {

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

void jpeg_output_message(j_common_ptr) {}

struct JpegEncodeState {
    jpeg_compress_struct cinfo{};
    JpegErrorManager err{};
    unsigned char* buffer = nullptr;
    unsigned long size = 0;
    std::vector<std::uint8_t> row;
};

// Alpha composited over white; libjpeg takes RGB rows.
void jpeg_encode_body(JpegEncodeState& st, const Bitmap& bitmap, int quality) {
    jpeg_compress_struct& cinfo = st.cinfo;
    jpeg_mem_dest(&cinfo, &st.buffer, &st.size);
    cinfo.image_width = static_cast<JDIMENSION>(bitmap.width);
    cinfo.image_height = static_cast<JDIMENSION>(bitmap.height);
    cinfo.input_components = 3;
    cinfo.in_color_space = JCS_RGB;
    jpeg_set_defaults(&cinfo);
    jpeg_set_quality(&cinfo, std::clamp(quality, 1, 100), TRUE);
    cinfo.optimize_coding = TRUE;
    jpeg_start_compress(&cinfo, TRUE);
    const std::size_t width = static_cast<std::size_t>(bitmap.width);
    st.row.resize(width * 3);
    while (cinfo.next_scanline < cinfo.image_height) {
        const std::uint8_t* src =
            bitmap.rgba.data() + static_cast<std::size_t>(cinfo.next_scanline) * width * 4;
        for (std::size_t x = 0; x < width; ++x) {
            const unsigned a = src[x * 4 + 3];
            for (std::size_t c = 0; c < 3; ++c) {
                const unsigned v = src[x * 4 + c];
                st.row[x * 3 + c] = static_cast<std::uint8_t>((v * a + 255 * (255 - a)) / 255);
            }
        }
        JSAMPROW rows[1] = {st.row.data()};
        jpeg_write_scanlines(&cinfo, rows, 1);
    }
    jpeg_finish_compress(&cinfo);
}

void png_write_to_string(png_structp png, png_bytep data, png_size_t length) {
    auto* out = static_cast<std::string*>(png_get_io_ptr(png));
    out->append(reinterpret_cast<const char*>(data), length);
}

void png_flush(png_structp) {}

struct PngEncodeState {
    std::string out;
    std::string error;
    std::vector<png_bytep> rows;
    std::vector<std::uint8_t> rgb;
};

void png_on_error(png_structp png, png_const_charp message) {
    auto* st = static_cast<PngEncodeState*>(png_get_error_ptr(png));
    if (st != nullptr) {
        st->error = message == nullptr ? "PNG error" : message;
    }
    png_longjmp(png, 1);
}

void png_on_warning(png_structp, png_const_charp) {}

void png_encode_body(PngEncodeState& st, png_structp png, png_infop info, const Bitmap& bitmap) {
    png_set_write_fn(png, &st.out, png_write_to_string, png_flush);
    const int color_type = bitmap.has_alpha ? PNG_COLOR_TYPE_RGB_ALPHA : PNG_COLOR_TYPE_RGB;
    png_set_IHDR(png, info, static_cast<png_uint_32>(bitmap.width),
                 static_cast<png_uint_32>(bitmap.height), 8, color_type, PNG_INTERLACE_NONE,
                 PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    png_set_compression_level(png, 6);
    png_write_info(png, info);
    const std::size_t width = static_cast<std::size_t>(bitmap.width);
    const std::size_t height = static_cast<std::size_t>(bitmap.height);
    st.rows.resize(height);
    if (bitmap.has_alpha) {
        for (std::size_t y = 0; y < height; ++y) {
            st.rows[y] = const_cast<png_bytep>(bitmap.rgba.data() + y * width * 4);
        }
    } else {
        st.rgb.resize(width * height * 3);
        for (std::size_t i = 0; i < width * height; ++i) {
            st.rgb[i * 3] = bitmap.rgba[i * 4];
            st.rgb[i * 3 + 1] = bitmap.rgba[i * 4 + 1];
            st.rgb[i * 3 + 2] = bitmap.rgba[i * 4 + 2];
        }
        for (std::size_t y = 0; y < height; ++y) {
            st.rows[y] = st.rgb.data() + y * width * 3;
        }
    }
    png_write_image(png, st.rows.data());
    png_write_end(png, nullptr);
}

}  // namespace

std::string encode_jpeg(const Bitmap& bitmap, int quality) {
    if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.rgba.size() < bitmap.pixel_count() * 4) {
        throw DecodeError("corrupt", "cannot encode an empty bitmap");
    }
    auto st = std::make_unique<JpegEncodeState>();
    st->cinfo.err = jpeg_std_error(&st->err.pub);
    st->err.pub.error_exit = jpeg_error_exit;
    st->err.pub.output_message = jpeg_output_message;
    if (setjmp(st->err.jump)) {
        jpeg_destroy_compress(&st->cinfo);
        std::free(st->buffer);
        throw DecodeError("corrupt", std::string("JPEG encode: ") + st->err.message);
    }
    jpeg_create_compress(&st->cinfo);
    jpeg_encode_body(*st, bitmap, quality);
    jpeg_destroy_compress(&st->cinfo);
    std::string out(reinterpret_cast<const char*>(st->buffer), st->size);
    std::free(st->buffer);
    return out;
}

std::string encode_png(const Bitmap& bitmap) {
    if (bitmap.width <= 0 || bitmap.height <= 0 || bitmap.rgba.size() < bitmap.pixel_count() * 4) {
        throw DecodeError("corrupt", "cannot encode an empty bitmap");
    }
    auto st = std::make_unique<PngEncodeState>();
    png_structp png =
        png_create_write_struct(PNG_LIBPNG_VER_STRING, st.get(), png_on_error, png_on_warning);
    if (png == nullptr) {
        throw DecodeError("corrupt", "PNG encode: cannot create writer");
    }
    png_infop info = png_create_info_struct(png);
    if (info == nullptr) {
        png_destroy_write_struct(&png, nullptr);
        throw DecodeError("corrupt", "PNG encode: cannot create info");
    }
    if (setjmp(png_jmpbuf(png))) {
        png_destroy_write_struct(&png, &info);
        throw DecodeError("corrupt", "PNG encode: " + st->error);
    }
    png_encode_body(*st, png, info, bitmap);
    png_destroy_write_struct(&png, &info);
    return std::move(st->out);
}

}  // namespace mfbe::images
