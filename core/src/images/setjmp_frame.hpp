// Feature 011 (D48): the functions that call setjmp for libjpeg's and libpng's error jumps hold
// nothing with a destructor (MSVC's C4611: "interaction between '_setjmp' and C++ object
// destruction is non-portable") and are never inlined into a caller that does.
#pragma once

#if defined(_MSC_VER)
#define MFBE_SETJMP_FRAME __declspec(noinline)
#else
#define MFBE_SETJMP_FRAME __attribute__((noinline))
#endif
