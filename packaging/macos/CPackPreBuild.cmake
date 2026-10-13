# CPACK_PRE_BUILD_SCRIPTS step of the DragNDrop generator (T145): ad-hoc signs the staged
# bundle after every component (app, resources, ui, scripts) has been copied into it and
# before the .dmg is created. Unsigned/un-notarised builds are acceptable (FR-123); the
# ad-hoc signature keeps macOS from refusing the binary outright on Apple Silicon and lets the
# "Open Anyway" first-launch step documented in docs/installing.md work.
if(NOT CPACK_TEMPORARY_DIRECTORY)
  message(FATAL_ERROR "CPACK_TEMPORARY_DIRECTORY is not set")
endif()
file(GLOB _bundles "${CPACK_TEMPORARY_DIRECTORY}/*.app" "${CPACK_TEMPORARY_DIRECTORY}/*/*.app")
if(NOT _bundles)
  message(FATAL_ERROR "no .app bundle found below ${CPACK_TEMPORARY_DIRECTORY}")
endif()
foreach(_bundle IN LISTS _bundles)
  message(STATUS "Ad-hoc signing ${_bundle}")
  execute_process(COMMAND codesign --force --deep --sign - "${_bundle}" RESULT_VARIABLE _result)
  if(NOT _result EQUAL 0)
    message(FATAL_ERROR "codesign failed for ${_bundle} (exit code ${_result})")
  endif()
  execute_process(COMMAND codesign --verify --deep --strict "${_bundle}" RESULT_VARIABLE _verify)
  if(NOT _verify EQUAL 0)
    message(FATAL_ERROR "codesign verification failed for ${_bundle}")
  endif()
endforeach()
