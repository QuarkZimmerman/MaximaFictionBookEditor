# CPACK_PRE_BUILD_SCRIPTS step of the ZIP generator (feature 002): adds an empty `bin/user`
# folder to the portable copy, where the editor then keeps all of its data, so the copy moves
# with its folder (contracts/resource-formats.md §1a). Not an install() rule: the MSI is built
# from the same install tree and must not have it.
if(NOT CPACK_TEMPORARY_DIRECTORY)
  message(FATAL_ERROR "CPACK_TEMPORARY_DIRECTORY is not set")
endif()
file(MAKE_DIRECTORY "${CPACK_TEMPORARY_DIRECTORY}/bin/user")
message(STATUS "Added bin/user to the ${CPACK_GENERATOR} staging tree")

# Feature 015 (review of rc.7, R1) & feature 020: the copy's default folders for the user's own
# additions come with their readme - the data folder (the template) and its genres, scripts,
# dictionaries and ocr folders.
if(NOT CPACK_MFBE_SOURCE_DIR)
  message(FATAL_ERROR "CPACK_MFBE_SOURCE_DIR is not set")
endif()
set(_mfbe_readmes "${CPACK_MFBE_SOURCE_DIR}/resources/user-readme")
file(COPY_FILE "${_mfbe_readmes}/data.md" "${CPACK_TEMPORARY_DIRECTORY}/bin/user/readme.md")
foreach(_mfbe_kind IN ITEMS genres scripts dictionaries ocr)
  file(MAKE_DIRECTORY "${CPACK_TEMPORARY_DIRECTORY}/bin/user/${_mfbe_kind}")
  file(COPY_FILE "${_mfbe_readmes}/${_mfbe_kind}.md"
       "${CPACK_TEMPORARY_DIRECTORY}/bin/user/${_mfbe_kind}/readme.md")
endforeach()
message(STATUS "Added the readme of bin/user and of its genres, scripts, dictionaries and ocr folders")
