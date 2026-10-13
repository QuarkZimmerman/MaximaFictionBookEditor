# Bundled data installed next to the executables (schema, genres, dictionaries,
# symbols, blank document, core messages, icons).
#
# The whole tree lands in <MFBE_INSTALL_DATADIR>/resources (component "resources"):
# share/mfbe/resources on Linux/Windows - what the core resolves as
# <exe>/../share/mfbe/resources - and mfbe.app/Contents/Resources/resources on macOS (passed
# to the core by the shell); see cmake/InstallLayout.cmake. That covers in particular (T087):
#   dictionaries/<tag>.aff + <tag>.dic   Hunspell pairs discovered as the bundled layer
#   dictionaries/<tag>.txt               licence/readme texts surfaced by spell.dictionaryLicense
#   genres/*.genres.tsv, names*.txt, categories*.tsv, languages.json, symbols.ini
# Provenance files (SOURCES.txt, README.md, missing-names.txt) stay out of the package.
# Verify with: cmake --install <build> --prefix <dir> --component resources
install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/"
  DESTINATION "${MFBE_INSTALL_DATADIR}/resources"
  COMPONENT resources
  PATTERN "CMakeLists.txt" EXCLUDE
  PATTERN "README.md" EXCLUDE
  PATTERN "SOURCE.txt" EXCLUDE
  PATTERN "SOURCES.txt" EXCLUDE
  PATTERN "missing-names.txt" EXCLUDE
  PATTERN "icons/strips" EXCLUDE
  PATTERN "icons/README.md" EXCLUDE)
