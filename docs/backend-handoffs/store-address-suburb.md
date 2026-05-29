# Backend handoff — Add `suburb` to store addresses

**Scope:** small additive change. New optional column on the `store_addresses` table + accept the field in create/update bodies. No migration risk (column is nullable; existing rows keep `null`).

**Why now:** product requirement during M1–M8 testing — South African addresses commonly include a suburb between the street and city (e.g. *"12 Long Street, Rosebank, Johannesburg, 2196"*). The current schema omits it, forcing merchants to cram suburb into `buildingName` or `streetName`. Frontend now collects suburb as a separate optional field.

**Frontend status:** the field is already in the form modal, the display card, the schemas, and the contract docs. The frontend will send `suburb` in the create/update bodies; today the backend silently drops it (or 400s on `forbidNonWhitelisted`, depending on your ValidationPipe config).

---

## What to change

### `store_addresses` table

Add a nullable `suburb` column:

```sql
ALTER TABLE store_addresses
  ADD COLUMN suburb varchar(100);
```

No backfill required. Existing rows get `null` and remain valid.

### `POST /stores/:storeId/addresses`

Body shape:

```ts
{
  streetNumber: string,    // required, max 20
  streetName: string,      // required, 2–100
  buildingName?: string,   // optional, max 100
  suburb?: string,         // ← NEW, optional, max 100
  city: string,            // required, 2–100
  postalCode: string,      // required, 4–10
}
```

### `PATCH /stores/:storeId/addresses/:addressId`

Same shape, all fields optional.

### `GET /stores/me` + admin queue endpoints

The `addresses` array on the response includes `suburb` on every row. Returns the literal `null` (not omitted) when unset — matches the `buildingName` pattern.

---

## Verifying the fix

```bash
TOKEN="<your_jwt>"
STORE_ID="<your_store_id>"
BASE="http://localhost:3001"

# 1. Add address with suburb (expect 201, suburb in the response body)
curl -X POST "$BASE/stores/$STORE_ID/addresses" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "streetNumber": "12",
    "streetName": "Long Street",
    "buildingName": "The Mews",
    "suburb": "Rosebank",
    "city": "Johannesburg",
    "postalCode": "2196"
  }'

# 2. Add address without suburb (expect 201, suburb: null in the response)
curl -X POST "$BASE/stores/$STORE_ID/addresses" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "streetNumber": "5",
    "streetName": "Bree Street",
    "city": "Cape Town",
    "postalCode": "8001"
  }'

# 3. Update suburb on existing address (expect 200)
curl -X PATCH "$BASE/stores/$STORE_ID/addresses/<address_id>" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "suburb": "Sea Point" }'

# 4. GET /stores/me — `suburb` field present on every address (string or null)
curl "$BASE/stores/me" -H "Authorization: Bearer $TOKEN"
```

---

## Spec is updated

`docs/Api-frontend-contracts/store-module-api.md`:
- Store Address Object — `suburb: string | null` added in the field list
- `POST /stores/:storeId/addresses` request body — `suburb` listed as optional, max 100 chars

PATCH inherits the same schema, no separate doc change needed.

---

## Optional / required

`suburb` is **optional** to:
- Match `buildingName`'s pattern (the only other location-qualifier optional)
- Avoid breaking existing addresses that don't have one
- Avoid blocking address creation when the merchant doesn't know / care to specify (rural addresses, informal areas, etc.)

If a future business rule requires suburb (e.g. for delivery routing zones), we can tighten the validation then — easier to make optional → required than the reverse.
