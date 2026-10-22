#!/usr/bin/env python3
"""Generate the Source view's tag-completion table from the FictionBook 2.1 schema.

Input (read-only): resources/schema/FictionBook.xsd and the schemas it imports or
includes (relative `schemaLocation`, resolved in the same folder). FictionNotes.xsd
is not reached from there (it imports FictionBook.xsd, not the other way round), so
the table holds the elements of FB2 documents only.

Output: ui/src/views/source/fb2Elements.json (feature 003, resource-formats.md section 7;
feature 005, its resource-formats.md amendment to section 12)

  {"root": "FictionBook",
   "elements": {"<name>": {"children": ["<name>", ...],
                           "attributes": [{"name", "required", "type"?}, ...],
                           "text": true | false}}}

`root` is the one global element of FictionBook.xsd. `elements` lists every element
declared anywhere in the schema (global or local, named or anonymous type) with the
names of the elements its content model allows, flattened: sequences, choices,
groups, nested particles and `complexContent` extensions are walked, order and
multiplicity are ignored, mixed content contributes nothing (text is not an element),
simple content and simple types have no children. An element name declared several
times (`body` as `bodyType` and `notesBodyType`, `publisher` as `authorType` and
`textFieldType`) gets the union of its declarations. Names and children are sorted
by code point.

`attributes` (feature 005) lists the attributes the element's type declares -
`xs:attribute` by name or by reference (`xml:lang`, `xlink:href`, as written), those of
referenced attribute groups and of the base types of `simpleContent` /
`complexContent` extensions - with `required` (`use="required"`) and the declared
`type` as written (`xs:string`, `xs:ID`, a named simple type; the restriction base of
an inline simple type; absent when the schema gives none); sorted by name, and
`required` only when every declaration of the element requires it. `text` is true
when the element may hold character data: a `mixed` complex type (or a mixed
`complexContent`, or an extension of a mixed base), simple content, a simple type -
built-in or named; an element without a type (`empty-line`) holds nothing. The core
builds the same `children` / `text` data from the bundled schema for the admission
check of `doc.fragmentFromXml` (core/src/xml/schema_table.cpp), and a Catch2 case
pins the two tables equal.

The file is formatted the way Prettier (printWidth 100) formats JSON, so the UI's
format check accepts it as committed.

Usage:
  python3 tools/fb2-schema-elements.py            # rewrite the table, print a summary
  python3 tools/fb2-schema-elements.py --check    # exit 1 when the committed table differs
      [--schema resources/schema/FictionBook.xsd] [--out ui/src/views/source/fb2Elements.json]

Standard library only; exit status 2 on usage errors or an unreadable schema.
"""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

XS_NS = "http://www.w3.org/2001/XMLSchema"
XS = "{%s}" % XS_NS
PRINT_WIDTH = 100

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SCHEMA = REPO / "resources" / "schema" / "FictionBook.xsd"
DEFAULT_OUT = REPO / "ui" / "src" / "views" / "source" / "fb2Elements.json"

# Particles whose children are walked for element declarations.
GROUPING = {XS + "sequence", XS + "choice", XS + "all"}


class SchemaError(Exception):
    pass


class SchemaDocument:
    """One parsed .xsd file with its prefix map and target namespace."""

    def __init__(self, path: Path):
        self.path = path
        # The `xml` prefix is bound by the XML specification itself, never declared.
        self.prefixes = {"xml": "http://www.w3.org/XML/1998/namespace"}
        try:
            # ElementTree drops the prefix declarations; iterparse reports them as events.
            for event, value in ET.iterparse(str(path), events=("start-ns",)):
                prefix, uri = value
                self.prefixes.setdefault(prefix, uri)
            self.root = ET.parse(str(path)).getroot()
        except (ET.ParseError, OSError) as exc:
            raise SchemaError("%s: %s" % (path, exc)) from exc
        if self.root.tag != XS + "schema":
            raise SchemaError("%s: not an XML Schema document (root %s)" % (path, self.root.tag))
        self.target_namespace = self.root.get("targetNamespace", "")

    def qname(self, value: str):
        """(namespace, local name) of a QName attribute value in this document."""
        if ":" in value:
            prefix, local = value.split(":", 1)
            if prefix not in self.prefixes:
                raise SchemaError("%s: unknown namespace prefix in %r" % (self.path, value))
            return self.prefixes[prefix], local
        # Unprefixed references use the default namespace when the document declares one.
        return self.prefixes.get("", ""), value


class Schema:
    """All loaded schema documents; named components indexed by (namespace, name)."""

    def __init__(self):
        self.documents = []
        self.types = {}  # (ns, name) -> (document, xs:complexType | xs:simpleType)
        self.groups = {}  # (ns, name) -> (document, xs:group)
        self.global_elements = {}  # (ns, name) -> (document, xs:element)
        self.global_attributes = {}  # (ns, name) -> (document, xs:attribute)
        self.attribute_groups = {}  # (ns, name) -> (document, xs:attributeGroup)
        self.notes = []
        self._loaded = set()

    def load(self, path: Path):
        path = path.resolve()
        if path in self._loaded:
            return
        self._loaded.add(path)
        doc = SchemaDocument(path)
        self.documents.append(doc)
        ns = doc.target_namespace
        for child in doc.root:
            name = child.get("name")
            if child.tag in (XS + "complexType", XS + "simpleType") and name:
                self.types[(ns, name)] = (doc, child)
            elif child.tag == XS + "group" and name:
                self.groups[(ns, name)] = (doc, child)
            elif child.tag == XS + "element" and name:
                self.global_elements[(ns, name)] = (doc, child)
            elif child.tag == XS + "attribute" and name:
                self.global_attributes[(ns, name)] = (doc, child)
            elif child.tag == XS + "attributeGroup" and name:
                self.attribute_groups[(ns, name)] = (doc, child)
            elif child.tag in (XS + "import", XS + "include", XS + "redefine"):
                location = child.get("schemaLocation")
                if not location:
                    continue  # e.g. the xml: namespace imported without a location
                target = (path.parent / location).resolve()
                if not target.exists():
                    self.notes.append("%s: %s not found, skipped" % (path.name, location))
                    continue
                self.load(target)

    # ---------------------------------------------------------------- children

    def children_of_element(self, doc: SchemaDocument, element: ET.Element):
        """Names of the elements the declaration's content model allows."""
        type_name = element.get("type")
        if type_name:
            key = doc.qname(type_name)
            if key[0] == XS_NS:
                return set()  # built-in simple type (xs:string, xs:token, ...)
            if key not in self.types:
                raise SchemaError("%s: element %r has unknown type %r"
                                  % (doc.path, element.get("name"), type_name))
            type_doc, type_node = self.types[key]
            return self.children_of_type(type_doc, type_node, ())
        inline = element.find(XS + "complexType")
        if inline is not None:
            return self.children_of_type(doc, inline, ())
        # No type at all (xs:anyType) or an inline simple type: nothing to offer. FB2 declares
        # `empty-line` without a type; it is an empty element.
        return set()

    def children_of_type(self, doc: SchemaDocument, type_node: ET.Element, seen):
        if type_node.tag != XS + "complexType":
            return set()  # xs:simpleType
        children = set()
        for child in type_node:
            if child.tag == XS + "simpleContent":
                return set()
            if child.tag == XS + "complexContent":
                for derivation in child:
                    if derivation.tag not in (XS + "extension", XS + "restriction"):
                        continue
                    base = derivation.get("base")
                    if derivation.tag == XS + "extension" and base:
                        key = doc.qname(base)
                        if key[0] != XS_NS:
                            if key not in self.types:
                                raise SchemaError("%s: unknown base type %r" % (doc.path, base))
                            if key in seen:
                                raise SchemaError("%s: circular derivation of %r"
                                                  % (doc.path, base))
                            base_doc, base_node = self.types[key]
                            children |= self.children_of_type(base_doc, base_node, seen + (key,))
                    # A restriction restates the content model it keeps: its own particles only.
                    children |= self.children_of_particles(doc, derivation)
                continue
            children |= self.children_of_particle(doc, child)
        return children

    def children_of_particles(self, doc: SchemaDocument, parent: ET.Element):
        children = set()
        for child in parent:
            children |= self.children_of_particle(doc, child)
        return children

    def children_of_particle(self, doc: SchemaDocument, node: ET.Element):
        if node.tag in GROUPING:
            return self.children_of_particles(doc, node)
        if node.tag == XS + "element":
            name = node.get("name")
            if name:
                return {name}
            ref = node.get("ref")
            if ref:
                key = doc.qname(ref)
                if key not in self.global_elements:
                    raise SchemaError("%s: unknown element reference %r" % (doc.path, ref))
                return {key[1]}
            raise SchemaError("%s: element without name or ref" % doc.path)
        if node.tag == XS + "group":
            ref = node.get("ref")
            if ref:
                key = doc.qname(ref)
                if key not in self.groups:
                    raise SchemaError("%s: unknown group reference %r" % (doc.path, ref))
                group_doc, group_node = self.groups[key]
                return self.children_of_particles(group_doc, group_node)
            return self.children_of_particles(doc, node)
        if node.tag == XS + "any":
            self.notes.append("%s: xs:any wildcard ignored" % doc.path.name)
        # xs:attribute, xs:attributeGroup, xs:anyAttribute, xs:annotation: no element children.
        return set()

    # -------------------------------------------------------------------- text

    def type_of_element(self, doc: SchemaDocument, element: ET.Element):
        """(document, type node) of the declaration, or (None, None) for a built-in type
        (the second member is then the built-in type's name) or no type at all."""
        type_name = element.get("type")
        if type_name:
            key = doc.qname(type_name)
            if key[0] == XS_NS:
                return None, key[1]
            if key not in self.types:
                raise SchemaError("%s: element %r has unknown type %r"
                                  % (doc.path, element.get("name"), type_name))
            return self.types[key]
        for tag in (XS + "complexType", XS + "simpleType"):
            inline = element.find(tag)
            if inline is not None:
                return doc, inline
        return None, None

    def text_of_element(self, doc: SchemaDocument, element: ET.Element) -> bool:
        """Whether the declaration's content model admits character data."""
        type_doc, type_node = self.type_of_element(doc, element)
        if type_doc is None:
            return type_node is not None  # a built-in simple type; nothing for xs:anyType
        return self.text_of_type(type_doc, type_node, ())

    def text_of_type(self, doc: SchemaDocument, type_node: ET.Element, seen) -> bool:
        if type_node.tag == XS + "simpleType":
            return True
        if type_node.tag != XS + "complexType":
            return False
        if type_node.get("mixed") == "true":
            return True
        for child in type_node:
            if child.tag == XS + "simpleContent":
                return True
            if child.tag == XS + "complexContent":
                if child.get("mixed") == "true":
                    return True
                for derivation in child:
                    base = derivation.get("base")
                    if derivation.tag != XS + "extension" or not base:
                        continue
                    key = doc.qname(base)
                    if key[0] != XS_NS and key in self.types and key not in seen:
                        base_doc, base_node = self.types[key]
                        if self.text_of_type(base_doc, base_node, seen + (key,)):
                            return True
        return False

    # -------------------------------------------------------------- attributes

    def attributes_of_element(self, doc: SchemaDocument, element: ET.Element):
        """name -> (required, type or None) of the attributes the declaration allows."""
        type_doc, type_node = self.type_of_element(doc, element)
        if type_doc is None:
            return {}
        return self.attributes_of_type(type_doc, type_node, ())

    def attributes_of_type(self, doc: SchemaDocument, type_node: ET.Element, seen):
        if type_node.tag != XS + "complexType":
            return {}
        attributes = {}
        for child in type_node:
            if child.tag in (XS + "simpleContent", XS + "complexContent"):
                for derivation in child:
                    if derivation.tag not in (XS + "extension", XS + "restriction"):
                        continue
                    base = derivation.get("base")
                    if derivation.tag == XS + "extension" and base:
                        key = doc.qname(base)
                        if key[0] != XS_NS and key in self.types and key not in seen:
                            base_doc, base_node = self.types[key]
                            attributes.update(
                                self.attributes_of_type(base_doc, base_node, seen + (key,)))
                    attributes.update(self.attributes_of_declarations(doc, derivation))
                continue
            attributes.update(self.attribute_of(doc, child))
        return attributes

    def attributes_of_declarations(self, doc: SchemaDocument, parent: ET.Element):
        attributes = {}
        for child in parent:
            attributes.update(self.attribute_of(doc, child))
        return attributes

    def attribute_of(self, doc: SchemaDocument, node: ET.Element):
        if node.tag == XS + "attributeGroup":
            ref = node.get("ref")
            if ref:
                key = doc.qname(ref)
                if key not in self.attribute_groups:
                    raise SchemaError("%s: unknown attribute group %r" % (doc.path, ref))
                group_doc, group_node = self.attribute_groups[key]
                return self.attributes_of_declarations(group_doc, group_node)
            return self.attributes_of_declarations(doc, node)
        if node.tag != XS + "attribute":
            return {}
        required = node.get("use") == "required"
        type_name = node.get("type")
        if not type_name:
            inline = node.find(XS + "simpleType")
            if inline is not None:
                restriction = inline.find(XS + "restriction")
                if restriction is not None:
                    type_name = restriction.get("base")
        ref = node.get("ref")
        if ref:
            key = doc.qname(ref)
            if key in self.global_attributes and not type_name:
                type_name = self.global_attributes[key][1].get("type")
            return {ref: (required, type_name)}
        name = node.get("name")
        if not name:
            raise SchemaError("%s: attribute without name or ref" % doc.path)
        return {name: (required, type_name)}

    # ------------------------------------------------------------------- table

    def element_table(self):
        """name -> {children, attributes, text}, over every element declaration of every
        document; a name declared several times gets the union (`required` only when every
        declaration requires the attribute)."""
        children = {}
        attributes = {}  # name -> {attribute -> [required flags, type]}
        text = {}
        declarations = 0
        for doc in self.documents:
            for element in doc.root.iter(XS + "element"):
                name = element.get("name")
                if not name:
                    continue  # a reference: the global declaration is listed itself
                declarations += 1
                children.setdefault(name, set()).update(self.children_of_element(doc, element))
                text[name] = text.get(name, False) or self.text_of_element(doc, element)
                merged = attributes.setdefault(name, {})
                for attribute, (required, type_name) in \
                        self.attributes_of_element(doc, element).items():
                    entry = merged.setdefault(attribute, [True, None])
                    entry[0] = entry[0] and required
                    entry[1] = entry[1] or type_name
        table = {}
        for name in sorted(children):
            table[name] = {
                "children": sorted(children[name]),
                "attributes": [
                    {"name": attribute, "required": required, "type": type_name}
                    for attribute, (required, type_name) in sorted(attributes[name].items())
                ],
                "text": text[name],
            }
        return table, declarations


def root_element(schema: Schema, main: Path):
    """The single global element of the main schema document."""
    main_doc = schema.documents[0]
    names = [name for (ns, name), (doc, _) in schema.global_elements.items() if doc is main_doc]
    if len(names) != 1:
        raise SchemaError("%s: expected one global element, found %s" % (main, names or "none"))
    return names[0]


# -------------------------------------------------------------------------- output


def json_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def format_array(key: str, items, indent: int, trailing: str, force_break: bool) -> str:
    """`"<key>": [...]` as Prettier prints it: on one line when the whole line (the trailing
    comma included) fits in PRINT_WIDTH and the array is not one Prettier always breaks
    (`force_break`: two or more objects), else one item per line."""
    inline = "[" + ", ".join(items) + "]"
    line = " " * indent + json_string(key) + ": " + inline + trailing
    if not force_break and len(line) <= PRINT_WIDTH:
        return inline
    body = (",\n").join(" " * (indent + 2) + item for item in items)
    return "[\n" + body + "\n" + " " * indent + "]"


def format_attribute(attribute) -> str:
    """One attribute object on one line, Prettier's spacing inside the braces."""
    members = ['"name": %s' % json_string(attribute["name"]),
               '"required": %s' % ("true" if attribute["required"] else "false")]
    if attribute["type"]:
        members.append('"type": %s' % json_string(attribute["type"]))
    return "{ " + ", ".join(members) + " }"


def render(root: str, table) -> str:
    lines = ["{", '  "root": %s,' % json_string(root), '  "elements": {']
    names = list(table)
    for index, name in enumerate(names):
        comma = "," if index < len(names) - 1 else ""
        entry = table[name]
        lines.append("    %s: {" % json_string(name))
        children = [json_string(c) for c in entry["children"]]
        lines.append('      "children": %s,' % format_array("children", children, 6, ",", False))
        attributes = [format_attribute(a) for a in entry["attributes"]]
        lines.append('      "attributes": %s,'
                     % format_array("attributes", attributes, 6, ",", len(attributes) > 1))
        lines.append('      "text": %s' % ("true" if entry["text"] else "false"))
        lines.append("    }" + comma)
    lines.append("  }")
    lines.append("}")
    return "\n".join(lines) + "\n"


def build(schema_path: Path):
    schema = Schema()
    schema.load(schema_path)
    table, declarations = schema.element_table()
    root = root_element(schema, schema_path)
    return render(root, table), len(table), declarations, schema.notes


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA, help="main schema file")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="generated JSON file")
    parser.add_argument(
        "--check",
        action="store_true",
        help="do not write; exit 1 when the committed file differs from the schema",
    )
    args = parser.parse_args(argv)

    try:
        text, count, declarations, notes = build(args.schema)
    except SchemaError as exc:
        print("fb2-schema-elements: %s" % exc, file=sys.stderr)
        return 2
    for note in notes:
        print("fb2-schema-elements: note: %s" % note, file=sys.stderr)

    summary = "%d elements from %d declarations" % (count, declarations)
    shown = display_path(args.out)
    if args.check:
        try:
            current = args.out.read_text(encoding="utf-8")
        except OSError:
            print("fb2-schema-elements: %s is missing; run the tool to generate it" % shown,
                  file=sys.stderr)
            return 1
        if current != text:
            print("fb2-schema-elements: %s is out of date (%s); run tools/fb2-schema-elements.py"
                  % (shown, summary), file=sys.stderr)
            return 1
        print("fb2-schema-elements: %s is up to date (%s)" % (shown, summary))
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8", newline="\n")
    print("fb2-schema-elements: wrote %s (%s)" % (shown, summary))
    return 0


def display_path(path: Path) -> str:
    """The path relative to the repository when it lies inside it (shorter messages)."""
    try:
        return str(path.resolve().relative_to(REPO))
    except ValueError:
        return str(path)


if __name__ == "__main__":
    sys.exit(main())
