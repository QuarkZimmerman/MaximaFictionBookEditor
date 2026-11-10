---
title: "A Pandoc Book"
author:
  - Jane Doe
abstract: "An abstract."
subject: "sea, ships"
publisher: "Acme"
identifier: "978-3-16-148410-0"
rights: "CC BY 4.0"
lang: en
css:
  - styles.css
  - https://example.org/web.css
header-includes: |
  <style>
  blockquote { margin: 0 2em; }
  div.note { color: gray; }
  </style>
unknown-key: "value"
---

# Chapter

Text with [a span]{.mark} and <span class="other">html span</span>.

::: {.note}
A note paragraph.
:::

<style>
em { font-style: italic; }
</style>
