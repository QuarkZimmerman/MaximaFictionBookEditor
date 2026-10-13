# CPACK_PRE_BUILD_SCRIPTS step of the DEB and RPM generators (T144): adds the AppArmor profile
# to the staged tree as /etc/apparmor.d/mfbe. It is not an install() rule on purpose - a
# developer's `cmake --install --prefix <dir>` must never write outside the prefix - and the
# package generators pick up everything present in CPACK_TEMPORARY_DIRECTORY.
if(NOT CPACK_TEMPORARY_DIRECTORY)
  message(FATAL_ERROR "CPACK_TEMPORARY_DIRECTORY is not set")
endif()
set(_profile "${CPACK_MFBE_SOURCE_DIR}/packaging/deb-rpm/apparmor/mfbe")
if(NOT EXISTS "${_profile}")
  message(FATAL_ERROR "AppArmor profile ${_profile} not found")
endif()
file(MAKE_DIRECTORY "${CPACK_TEMPORARY_DIRECTORY}/etc/apparmor.d")
file(COPY "${_profile}" DESTINATION "${CPACK_TEMPORARY_DIRECTORY}/etc/apparmor.d"
  FILE_PERMISSIONS OWNER_READ OWNER_WRITE GROUP_READ WORLD_READ)
message(STATUS "Added /etc/apparmor.d/mfbe to the ${CPACK_GENERATOR} staging tree")
