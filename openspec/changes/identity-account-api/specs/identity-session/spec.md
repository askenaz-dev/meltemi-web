## ADDED Requirements

### Requirement: Product-signed calls
A product SHALL call the service's `/api/*` with `Meltemi-Product: <name>` (a product of
`PRODUCTS`), `Meltemi-Timestamp: <ISO 8601 UTC time>` and `Meltemi-Signature: v1=<hex
HMAC-SHA256>` computed with the product's secret (`EVENTS_SECRET_<NAME>`, the one that signs the
events sent to it) over `"<timestamp>\n<METHOD>\n<path and query>\n<hex SHA-256 of the body>"`,
and `Authorization: Bearer <the person's session token>`. The service SHALL refuse with `401
product.unauthorized` a signature that does not verify, an unknown product or a timestamp more
than five minutes from its clock, without saying which, and with `401 session.invalid` a token
that does not verify or whose session is not live. The reference package SHALL export
`signProductRequest` (the headers for a call), `verifyProductRequest`, the types of the account
API's answers, and a test helper that mints a signed call, so that a product never writes the
scheme itself.

#### Scenario: A signed call is accepted
- **WHEN** a product signs `POST /api/account/sessions/revoke-others` with its secret, a current timestamp and the person's token
- **THEN** the service accepts it and the other sessions are revoked

#### Scenario: A stale timestamp
- **WHEN** the same call carries a timestamp eleven minutes old
- **THEN** the answer is `401 product.unauthorized` and nothing changes

#### Scenario: Another product's secret
- **WHEN** the call names `diagrams` but is signed with another product's secret
- **THEN** the answer is `401 product.unauthorized`

#### Scenario: A dead session
- **WHEN** the call is well signed and the token's session was revoked
- **THEN** the answer is `401 session.invalid`

#### Scenario: Signed by the package
- **WHEN** a product's test builds a call with `signProductRequest` and sends it to the service in a test
- **THEN** `verifyProductRequest` names the product and the route runs
