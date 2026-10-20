# Listing Schema

Write `output/listing.json`. This is the only copy/attribute file the builder needs.

```json
{
  "schema_version": "1.0",
  "language": "en",
  "mode": "new_product",
  "category": {
    "suggested_path_en": "Category > Subcategory > Product type",
    "suggested_path_zh": "类目 >> 子类目 >> 产品类型",
    "selection": "manual_required",
    "note": "Category must be selected manually before filling because attributes differ."
  },
  "title": "English title, at most 128 characters",
  "keywords": ["primary keyword", "secondary keyword", "application keyword"],
  "description_html": "<p>Intro paragraph.</p><h3>Key Features</h3><ul><li>...</li></ul>",
  "attributes": {
    "Type": "visible or confirmed product type",
    "Material": "visible or confirmed material",
    "Place of Origin": "{{company.origin}}",
    "Brand Name": "{{company.brand}}",
    "Manufacturer Batch": "{{company.manufacturer_batch}}"
  },
  "attribute_sources": {
    "Type": "images",
    "Material": "images",
    "Place of Origin": "plugin_config",
    "Brand Name": "plugin_config",
    "Manufacturer Batch": "plugin_config"
  },
  "custom_attributes": {},
  "custom_attribute_sources": "reference_listing",
  "moq": {
    "value": 100,
    "unit": "piece",
    "source": "default",
    "note": "Generic starting MOQ; confirm with factory."
  },
  "price": {
    "currency": "USD",
    "tiers": [],
    "reference_range": null,
    "source": "missing",
    "note": "Business-sensitive; fill manually."
  },
  "packaging": {
    "method": "Poly bag + export carton",
    "size": "",
    "weight": "",
    "source": "default",
    "note": "Confirm carton size and gross weight."
  },
  "lead_time": {
    "min_days": 15,
    "max_days": 30,
    "source": "default",
    "note": "Generic lead time; confirm production capacity."
  },
  "images": [
    {
      "file": "images/example.png",
      "role": "main",
      "order": 1,
      "note": "front view"
    }
  ],
  "certifications": {
    "value": [],
    "source": "missing",
    "note": "Confirm certification marks before claiming them."
  },
  "missing": [
    {
      "field": "price",
      "reason": "Not visible in images and business-sensitive.",
      "action": "Fill manually in the plugin."
    }
  ],
  "reference_listing": null
}
```

## Title

- Keep it between 40 and 128 characters.
- Put the product type and main differentiator first.
- Include one or two concrete specs or use cases when they are confirmed.
- No ALL CAPS, no `best`, `cheapest`, `high quality`, or other unverifiable claims.
- Do not put company names or `{{company.*}}` placeholders in the title.

## Keywords

- Use 3-5 phrases, each 2-5 words.
- No duplicates and no brand names unless the user owns the brand.
- Prefer product type, key specification, and application phrases.

## Description HTML

Use these sections when the information exists:

1. Intro paragraph: what the product is and its main benefit.
2. `Key Features`: bullet list.
3. `Specifications`: two-column HTML table.
4. `Applications`: concrete use cases.
5. `Installation` or `How to Use`: only if the process is confirmed.
6. `Package Contents`: only if confirmed by images or the user.
7. `Customization`: OEM/ODM services that the user actually offers.

Rules:

- HTML only. No `<script>`, inline event handlers, iframes, or external links.
- Use the exact values from `vision.json` or a user-supplied reference. Do not invent numbers.
- Do not claim waterproofing, certification, compatibility, or performance without evidence.
- Do not include company contact details, prices, MOQ, or lead time in the description.

## Attributes

- Use the category's real attribute names when known; otherwise use clear English names.
- Values may be strings, numbers, or booleans.
- Company fields use only these placeholders: `{{company.brand}}`, `{{company.origin}}`, `{{company.manufacturer_batch}}`, `{{company.name}}`.
- Do not use placeholders in `title`, `keywords`, or `description_html`.
- Valid sources: `images`, `engineering_drawing`, `reference_listing`, `default`, `inferred`, `plugin_config`, `missing`.
- `inferred` is only for safe application/use wording, never for numeric specifications.
- `custom_attribute_sources` may be one source string for all custom attributes, or an object keyed by attribute name.

## Missing

Add one entry for every unknown or business-sensitive field, including:

- price, MOQ, lead time
- carton size, gross weight
- certifications, IP/waterproof rating
- model number, cable compatibility, impedance/frequency/VSWR when not visible
- brand, origin, batch, company profile

Each entry needs `field`, `reason`, and a concrete `action`.

## Images

- Put the main image first.
- Use the files produced by `prepare-images.js`.
- `role` is one of `main`, `gallery`, `detail`, `specification`.
- `order` starts at 1 and is unique.

## Reference Listing

If the user supplies an existing Alibaba item, include:

```json
"reference_listing": {
  "item_id": "123",
  "title": "reference title",
  "category_zh": "类目 >> 子类目",
  "url": "https://...",
  "note": "Used as a reference for specifications; confirm before publishing."
}
```

Mark every attribute derived from it as `reference_listing` and add a confirmation entry to `missing`.
