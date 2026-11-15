# User folder fixtures (feature 015)

Items the tests copy into the designated folders (the folder chosen in Settings, the per-user data
folder, the portable folder): valid ones that must be in effect - `my.genres.tsv` (a 5-field line
with a Ukrainian name and a 4-field line), the script package `my-test-script/`, the template
`blank.fb2` (first paragraph `USER TEMPLATE MARKER`), the dictionary `xx_XX` - and ones the editor
passes over with a reason: `genres.txt` (name), `stray.js` (not a folder), `no-description/` (no
`script.json`), `yy_YY.aff` (no `.dic` partner).
