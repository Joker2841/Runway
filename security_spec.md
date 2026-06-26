# Security Specification & Threat Model

This document defines the security specification, data invariants, and threat vectors ("Dirty Dozen" payloads) for the Runway application's Firestore backend.

## 1. Data Invariants

- **Ownership Consistency**: A commitment must always belong to a single authenticated user. The `userId` property must be immutable once created, and it must exactly match the authenticated user's UID (`request.auth.uid`).
- **Resource ID Guarding**: The document ID (`commitmentId`) must be a valid alphanumeric/hyphen string, preventing string injection/poisoning.
- **Strict Size/Type Limits**: All strings (such as `title`, `approvedArtifact`, `reasoningTrace`) must have explicit upper limits to prevent Denial of Wallet and storage consumption attacks.
- **Zero-Trust Access Control**: No authenticated user is allowed to read, write, update, or delete commitments belonging to another user.

---

## 2. The "Dirty Dozen" Payloads

Here are 12 specific JSON payloads designed to violate identity, integrity, or state boundaries, and which MUST return `PERMISSION_DENIED`.

### Payload 1: Identity Spoofing (Setting another user's UID on Create)
- **Intent**: Write a commitment referencing another user's `userId`.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 2: Identity Hijacking (Modifying ownership on Update)
- **Intent**: Update a commitment to change the `userId` field to a different value.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 3: Unauthenticated Creation
- **Intent**: Try to create a commitment without being signed in.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 4: Unauthenticated Read
- **Intent**: Try to list or get commitments without being signed in.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 5: Resource Poisoning (Large Title String)
- **Intent**: Send a massive title string (e.g. 5MB) to trigger high storage fees.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 6: Resource Poisoning (Large Reasoning Trace String)
- **Intent**: Send a massive reasoning trace string.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 7: Path Variable ID Poisoning
- **Intent**: Request a document write with a custom ID composed of path traversal or giant junk strings.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 8: Cross-User List Query (Blanket Read)
- **Intent**: Query commitments without specifying the owner ID filtering clause.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 9: Cross-User Deletion
- **Intent**: Delete a commitment belonging to another user.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 10: State Shortcutting (Injecting arbitrary fields)
- **Intent**: Inject arbitrary non-whitelisted fields (e.g. `isAdmin: true` or `role: 'editor'`) into a commitment document.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 11: Invalid Value Types
- **Intent**: Send a non-boolean type (e.g. string `"yes"`) for boolean fields like `defended` or `completed`.
- **Expected Result**: `PERMISSION_DENIED`

### Payload 12: Invalid Numeric Effort Hours
- **Intent**: Send a string `"two hours"` or massive integer for `effortHours`.
- **Expected Result**: `PERMISSION_DENIED`

---

## 3. Test Runner Definition

The application utilizes direct secure Firebase rules in production. In standard local development, rules are verified against mock requests ensuring permissions are correctly denied on unauthorized actions.
