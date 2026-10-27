# Authentication Flow (STRIDE Example)

This diagram illustrates a user login process to highlight 
the new integrated STRIDE Threat Modeling annotations.

## STRIDE Threat Matrix

| ID | Categories | Risk | Score | Location | Description |
|---|---|---|---|---|---|
| T-1 | **S, I** | Critical | 9.2 | Web Browser &rarr; Auth Gateway | Credential stuffing attack on the public facing login portal. |
| T-2 | **E, D** | High | 8.1 | Auth Gateway &rarr; Redis Session Store | Redis instance exposed without password authentication. |
| T-3 | **T, I** | High | 7.5 | Web Browser &rarr; Auth Gateway | TLS Downgrade attack leading to MITM password interception. |
| T-4 | **S** | Medium | 6.1 | Auth Gateway &rarr; Web Browser | Cookie missing HttpOnly and Secure flags, susceptible to XSS extraction. |
| T-5 | **I** | Medium | 5.4 | Auth Gateway &rarr; Redis Session Store | Weak entropy used for SessionID generation. |
| T-6 | **D** | Low | 3.0 | Global &rarr; Architecture | Public endpoint discovery via automated scanning |
| T-7 | **S** | Medium | N/A | Global &rarr; Architecture | Application layer DoS on the login route |

## Data Flows

### 1. Web Browser -> Auth Gateway: POST /login
- **Data Exchanged:** Username, Password
- **Identified Threats:**
  - <span style="color:#982C35; font-weight:bold;">[Critical]</span> **[S, I]** (Score: 9.2) - Credential stuffing attack on the public facing login portal.
  - <span style="color:#CD3B48; font-weight:bold;">[High]</span> **[T, I]** (Score: 7.5) - TLS Downgrade attack leading to MITM password interception.

**Description:**
User submits credentials over TLS.

### 2. Auth Gateway -> Redis Session Store: Create Session
- **Data Exchanged:** SessionID, JWT Token
- **Identified Threats:**
  - <span style="color:#CD3B48; font-weight:bold;">[High]</span> **[E, D]** (Score: 8.1) - Redis instance exposed without password authentication.
  - <span style="color:#D97706; font-weight:bold;">[Medium]</span> **[I]** (Score: 5.4) - Weak entropy used for SessionID generation.

**Description:**
Store the active session mapping.

### 3. Auth Gateway -> Web Browser: Return 200 OK
- **Data Exchanged:** Set-Cookie: session_id
- **Identified Threats:**
  - <span style="color:#D97706; font-weight:bold;">[Medium]</span> **[S]** (Score: 6.1) - Cookie missing HttpOnly and Secure flags, susceptible to XSS extraction.
