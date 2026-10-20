# Vision Schema

Write `output/vision.json` after inspecting at most three images: main view, detail/exploded view, and specification/engineering drawing. Do not inspect every gallery image.

```json
{
  "schema_version": "1.0",
  "product_family": "short product family name",
  "source_images": [
    {
      "file": "images/example.png",
      "original": "产品/example.avif",
      "role": "main",
      "view": "front / side / isometric / exploded / engineering drawing",
      "notes": "only details visible in this image"
    }
  ],
  "facts_from_images": {
    "product_type": "visible product type",
    "gender": "male / female / n/a",
    "orientation": "straight / right angle / n/a",
    "mounting": "cable mount / panel mount / pcb mount / n/a",
    "termination": "visible termination method",
    "materials": {
      "body": "visible body material or finish",
      "contact": "visible contact material or finish",
      "insulator": "visible insulator material or color"
    },
    "color": "dominant visible color",
    "dimensions": {
      "overall_length_mm": 0,
      "max_diameter_mm": 0,
      "thread": "literal thread marking"
    },
    "components": ["visible component names"],
    "visible_text": ["literal text visible in the images"],
    "visible_branding": false,
    "visible_certifications": false,
    "packaging_shown": false
  },
  "not_visible_in_images": [
    "every specification, business value, or company field that cannot be confirmed"
  ]
}
```

## Rules

- Record only what is visible. Do not infer a specification from the product category or from similar products.
- Include units for every dimension. If a dimension is unreadable, omit it and add the field to `not_visible_in_images`.
- Use `visible_text` for literal markings such as `42.1`, `5/8-24 UNEF-2B`, or `N`.
- Do not infer impedance, frequency range, VSWR, cable compatibility, certifications, IP rating, MOQ, price, lead time, packing size/weight, brand, model number, or company data from appearance.
- `visible_branding`, `visible_certifications`, and `packaging_shown` are booleans based on what is actually shown.
- This file is traceability for the copywriter and reviewer. It is not the final listing copy.
