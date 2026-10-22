# Bundled data installed next to the executables (schema, genres, dictionaries,
# symbols, blank document, core messages, icons, AI service list, CA bundle).
#
# The whole tree lands in <MFBE_INSTALL_DATADIR>/resources (component "resources"):
# share/mfbe/resources on Linux/Windows - what the core resolves as
# <exe>/../share/mfbe/resources - and mfbe.app/Contents/Resources/resources on macOS (passed
# to the core by the shell); see cmake/InstallLayout.cmake. That covers in particular (T087):
#   dictionaries/<tag>.aff + <tag>.dic   Hunspell pairs discovered as the bundled layer
#   dictionaries/<tag>.txt               licence/readme texts surfaced by spell.dictionaryLicense
#   genres/*.genres.tsv, names*.txt, categories*.tsv, languages.json, symbols.ini
#   ai-services.json                     the bundled AI service list (feature 005)
#   certs/cacert.pem + cacert.NOTICE.txt the Mozilla CA bundle with its notice and licence text
#                                        (MPL-2.0.txt) - Linux packages only, see below
# Provenance files (SOURCES.txt, README.md, missing-names.txt) stay out of the package.
# Verify with: cmake --install <build> --prefix <dir> --component resources

# The CA bundle is the last fallback of the core's TLS verification on Linux (feature 005,
# resource-formats section C): used only when neither the environment nor the distribution
# provides a bundle. Windows verifies through Schannel and the Windows certificate store, macOS
# through Apple SecTrust and the keychain, so the MSI, the portable ZIP and the disk image carry
# no certs folder at all.
set(MFBE_RESOURCES_PLATFORM_EXCLUDES "")
if(WIN32 OR APPLE)
  list(APPEND MFBE_RESOURCES_PLATFORM_EXCLUDES PATTERN "certs" EXCLUDE)
endif()

install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/"
  DESTINATION "${MFBE_INSTALL_DATADIR}/resources"
  COMPONENT resources
  PATTERN "CMakeLists.txt" EXCLUDE
  PATTERN "README.md" EXCLUDE
  PATTERN "SOURCE.txt" EXCLUDE
  PATTERN "SOURCES.txt" EXCLUDE
  PATTERN "missing-names.txt" EXCLUDE
  PATTERN "icons/strips" EXCLUDE
  PATTERN "icons/README.md" EXCLUDE
  ${MFBE_RESOURCES_PLATFORM_EXCLUDES})
