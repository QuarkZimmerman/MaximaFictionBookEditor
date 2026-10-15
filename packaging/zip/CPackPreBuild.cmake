# CPACK_PRE_BUILD_SCRIPTS step of the ZIP generator (feature 002): adds an empty `bin/user`
# folder to the portable copy, where the editor then keeps all of its data, so the copy moves
# with its folder (contracts/resource-formats.md §1a). Not an install() rule: the MSI is built
# from the same install tree and must not have it.
if(NOT CPACK_TEMPORARY_DIRECTORY)
  message(FATAL_ERROR "CPACK_TEMPORARY_DIRECTORY is not set")
endif()
file(MAKE_DIRECTORY "${CPACK_TEMPORARY_DIRECTORY}/bin/user")
message(STATUS "Added bin/user to the ${CPACK_GENERATOR} staging tree")
