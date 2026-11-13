// Feature 014 (plan DP-3, tasks T025): joining the printed parts.

#include "pdf/join.hpp"

#include "pdf/document.hpp"

#include <Array.h>
#include <Dict.h>
#include <Object.h>
#include <Stream.h>
#include <XRef.h>
#include <map>
#include <optional>
#include <stdexcept>
#include <utility>

namespace mfbe::pdf {
namespace {

// The object an entry stands for, and the reference it is written back to (none: held directly).
struct Held {
    Object object;
    std::optional<Ref> ref;
};

Held hold(XRef* xref, const Object& entry) {
    Held h;
    if (entry.isRef()) {
        h.ref = entry.getRef();
        h.object = xref->fetch(entry.getRef());
    } else {
        h.object = entry.copy();
    }
    return h;
}

// Writes a held object back where it came from: its reference, or the key of `owner`.
void put_back(XRef* xref, Held& held, Object& owner, const char* key) {
    if (held.ref) {
        xref->setModifiedObject(&held.object, *held.ref);
    } else {
        owner.dictSet(key, std::move(held.object));
    }
}

// The number tree `tree` as one flat list of (key, value) pairs.
void flatten(XRef* xref, const Object& tree, std::vector<std::pair<int, Object>>& out,
             int depth = 0) {
    if (!tree.isDict() || depth > 32)
        return;
    const Object& nums = tree.dictLookupNF("Nums");
    const Object list = nums.isRef() ? xref->fetch(nums.getRef()) : nums.copy();
    if (list.isArray()) {
        for (int i = 0; i + 1 < list.arrayGetLength(); i += 2) {
            const Object& key = list.arrayGetNF(i);
            if (key.isInt())
                out.emplace_back(key.getInt(), list.arrayGetNF(i + 1).copy());
        }
    }
    const Object kids = tree.dictLookup("Kids");
    if (kids.isArray()) {
        for (int i = 0; i < kids.arrayGetLength(); ++i)
            flatten(xref, kids.arrayGet(i), out, depth + 1);
    }
}

// Copies objects of part B into the file A, each reference of B to one new reference of A.
class Importer {
public:
    Importer(XRef* a, XRef* b, int struct_offset) : a_(a), b_(b), offset_(struct_offset) {}

    void map(Ref from, Ref to) { refs_[from.num] = to; }

    Object import(const Object& o) {
        if (o.isRef())
            return Object(import_ref(o.getRef()));
        if (o.isArray()) {
            auto array = std::make_unique<Array>(a_);
            for (int i = 0; i < o.arrayGetLength(); ++i)
                array->add(import(o.arrayGetNF(i)));
            return Object(std::move(array));
        }
        if (o.isDict())
            return Object(import_dict(o.getDict()));
        return o.copy();
    }

private:
    Ref import_ref(Ref ref) {
        if (const auto it = refs_.find(ref.num); it != refs_.end())
            return it->second;
        // The new reference first, so that cycles (a page and its tree, an element and its parent)
        // meet it.
        const Ref target = a_->addIndirectObject(Object::null());
        refs_[ref.num] = target;
        const Object source = b_->fetch(ref);
        Object copy;
        if (source.isStream()) {
            // Poppler writes a stream held in memory unencoded (PDFDoc::writeObject): under
            // /FlateDecode it compresses the bytes itself, and any other filter it drops unless the
            // stream forbids that. So a stream goes in decoded under /FlateDecode, but a picture
            // codec's bytes (a JPEG...) go in as they are with their filter kept.
            Stream* s = source.getStream();
            Dict* d = source.streamGetDict();
            auto dict = import_dict(d);
            const Object filter = d->lookup("Filter");
            const bool parms = !d->lookup("DecodeParms").isNull();
            const bool codec = filter.isName("DCTDecode") || filter.isName("JPXDecode") ||
                               filter.isName("JBIG2Decode") || filter.isName("CCITTFaxDecode");
            const bool keep = codec && !parms;
            Stream* from = keep ? s->getBaseStream() : s;
            std::vector<unsigned char> data;
            if (from->rewind()) {
                data = from->toUnsignedChars();
                from->close();
            }
            if (!keep) {
                dict->remove("DecodeParms");
                if (filter.isNull()) {
                    dict->remove("Filter");
                } else {
                    dict->set("Filter", Object(objName, "FlateDecode"));
                }
            }
            dict->set("Length", Object(static_cast<int>(data.size())));
            auto stream = std::make_unique<AutoFreeMemStream>(
                std::vector<char>(data.begin(), data.end()), Object(std::move(dict)));
            stream->setFilterRemovalForbidden(keep);
            copy = Object(std::move(stream));
        } else {
            copy = import(source);
        }
        a_->setModifiedObject(&copy, target);
        return target;
    }

    std::unique_ptr<Dict> import_dict(Dict* d) {
        auto out = std::make_unique<Dict>(a_);
        for (int i = 0; i < d->getLength(); ++i) {
            const std::string key = d->getKey(i);
            const Object& value = d->getValNF(i);
            // Keys of the parent tree move past the first parts' (pages, annotations, forms).
            if ((key == "StructParents" || key == "StructParent") && value.isInt()) {
                out->set(key, Object(value.getInt() + offset_));
            } else {
                out->set(key, import(value));
            }
        }
        return out;
    }

    XRef* a_;
    XRef* b_;
    int offset_;
    std::map<int, Ref> refs_;
};

void append_part(PDFDoc& a, PDFDoc& b) {
    XRef* xa = a.getXRef();
    XRef* xb = b.getXRef();
    Object catalog_a = xa->getCatalog();
    Object catalog_b = xb->getCatalog();
    if (!catalog_a.isDict() || !catalog_b.isDict())
        throw std::runtime_error("a part has no catalog");

    Held pages_a = hold(xa, catalog_a.dictLookupNF("Pages"));
    const Object& pages_b_entry = catalog_b.dictLookupNF("Pages");
    const Object pages_b =
        pages_b_entry.isRef() ? xb->fetch(pages_b_entry.getRef()) : pages_b_entry.copy();
    if (!pages_a.object.isDict() || !pages_b.isDict() || !pages_a.ref || !pages_b_entry.isRef()) {
        throw std::runtime_error("a part has no page tree");
    }

    Held struct_a = hold(xa, catalog_a.dictLookupNF("StructTreeRoot"));
    const Object& struct_b_entry = catalog_b.dictLookupNF("StructTreeRoot");
    const Object struct_b =
        struct_b_entry.isRef() ? xb->fetch(struct_b_entry.getRef()) : struct_b_entry.copy();
    const bool tagged = struct_a.object.isDict() && struct_b.isDict();
    const int offset = tagged && struct_a.object.dictLookup("ParentTreeNextKey").isInt()
                           ? struct_a.object.dictLookup("ParentTreeNextKey").getInt()
                           : 0;

    Importer importer(xa, xb, offset);
    importer.map(pages_b_entry.getRef(), *pages_a.ref);
    if (tagged && struct_a.ref && struct_b_entry.isRef())
        importer.map(struct_b_entry.getRef(), *struct_a.ref);

    // The document element of each structure tree: B's children join A's.
    std::optional<Held> document_a;
    Object document_b;
    if (tagged) {
        Held k = hold(xa, struct_a.object.dictLookupNF("K"));
        const Object& kb = struct_b.dictLookupNF("K");
        if (k.ref && k.object.isDict() && kb.isRef()) {
            importer.map(kb.getRef(), *k.ref);
            document_b = xb->fetch(kb.getRef());
            document_a = std::move(k);
        }
    }
    // B's named destinations join A's; their dictionary itself is not copied.
    const Object& dests_b_entry = catalog_b.dictLookupNF("Dests");
    const Object dests_b =
        dests_b_entry.isRef() ? xb->fetch(dests_b_entry.getRef()) : dests_b_entry.copy();
    Held dests_a = hold(xa, catalog_a.dictLookupNF("Dests"));
    if (dests_b_entry.isRef() && dests_a.ref)
        importer.map(dests_b_entry.getRef(), *dests_a.ref);

    // The pages.
    Object kids_a = pages_a.object.dictLookup("Kids");
    const Object kids_b = pages_b.dictLookup("Kids");
    if (!kids_a.isArray() || !kids_b.isArray())
        throw std::runtime_error("a part has no pages");
    auto kids = std::make_unique<Array>(xa);
    for (int i = 0; i < kids_a.arrayGetLength(); ++i)
        kids->add(kids_a.arrayGetNF(i).copy());
    for (int i = 0; i < kids_b.arrayGetLength(); ++i)
        kids->add(importer.import(kids_b.arrayGetNF(i)));
    const int count_a = pages_a.object.dictLookup("Count").isInt()
                            ? pages_a.object.dictLookup("Count").getInt()
                            : 0;
    const int count_b =
        pages_b.dictLookup("Count").isInt() ? pages_b.dictLookup("Count").getInt() : 0;
    pages_a.object.dictSet("Kids", Object(std::move(kids)));
    pages_a.object.dictSet("Count", Object(count_a + count_b));
    xa->setModifiedObject(&pages_a.object, *pages_a.ref);

    if (tagged) {
        if (document_a) {
            auto children = std::make_unique<Array>(xa);
            const Object& ka = document_a->object.dictLookupNF("K");
            const auto add_all = [&children](const Object& k, auto&& convert) {
                if (k.isArray()) {
                    for (int i = 0; i < k.arrayGetLength(); ++i)
                        children->add(convert(k.arrayGetNF(i)));
                } else if (!k.isNull()) {
                    children->add(convert(k));
                }
            };
            add_all(ka, [](const Object& o) { return o.copy(); });
            add_all(document_b.dictLookupNF("K"),
                    [&importer](const Object& o) { return importer.import(o); });
            document_a->object.dictSet("K", Object(std::move(children)));
            xa->setModifiedObject(&document_a->object, *document_a->ref);
        }
        // The parent tree: one flat list, B's keys after A's.
        std::vector<std::pair<int, Object>> nums;
        flatten(xa, struct_a.object.dictLookup("ParentTree"), nums);
        std::vector<std::pair<int, Object>> nums_b;
        flatten(xb, struct_b.dictLookup("ParentTree"), nums_b);
        auto list = std::make_unique<Array>(xa);
        for (auto& [key, value] : nums) {
            list->add(Object(key));
            list->add(std::move(value));
        }
        for (auto& [key, value] : nums_b) {
            list->add(Object(key + offset));
            list->add(importer.import(value));
        }
        auto tree = std::make_unique<Dict>(xa);
        tree->set("Nums", Object(std::move(list)));
        Held parent_tree = hold(xa, struct_a.object.dictLookupNF("ParentTree"));
        parent_tree.object = Object(std::move(tree));
        put_back(xa, parent_tree, struct_a.object, "ParentTree");
        const int next_b = struct_b.dictLookup("ParentTreeNextKey").isInt()
                               ? struct_b.dictLookup("ParentTreeNextKey").getInt()
                               : static_cast<int>(nums_b.empty() ? 0 : nums_b.back().first + 1);
        struct_a.object.dictSet("ParentTreeNextKey", Object(offset + next_b));
        put_back(xa, struct_a, catalog_a, "StructTreeRoot");
    }

    if (dests_b.isDict()) {
        if (!dests_a.object.isDict())
            dests_a.object = Object(std::make_unique<Dict>(xa));
        for (int i = 0; i < dests_b.dictGetLength(); ++i) {
            dests_a.object.dictSet(dests_b.dictGetKey(i), importer.import(dests_b.dictGetValNF(i)));
        }
        put_back(xa, dests_a, catalog_a, "Dests");
    }
    xa->setModifiedObject(&catalog_a, xa->getRoot());
}

}  // namespace

std::vector<char> join_parts(std::vector<std::vector<char>> parts,
                             const std::function<void(int done, int total)>& progress) {
    if (parts.empty())
        throw std::runtime_error("no part was printed");
    if (parts.size() == 1)
        return std::move(parts.front());
    std::string error;
    auto first = Document::open_bytes(std::move(parts.front()), &error);
    if (!first)
        throw std::runtime_error("part 1 is not readable: " + error);
    for (std::size_t i = 1; i < parts.size(); ++i) {
        auto next = Document::open_bytes(std::move(parts[i]), &error);
        if (!next)
            throw std::runtime_error("part " + std::to_string(i + 1) +
                                     " is not readable: " + error);
        append_part(*first->impl().doc, *next->impl().doc);
        if (progress)
            progress(static_cast<int>(i), static_cast<int>(parts.size()) - 1);
    }
    std::vector<char> joined = first->save();
    if (joined.empty())
        throw std::runtime_error("the joined file could not be written");
    return joined;
}

}  // namespace mfbe::pdf
