# Mobile Payment Flow

Architecture for processing customer orders and handling
payments securely through a third-party gateway.

## Global Threats
- **Distributed Denial of Service (DDoS) against the public API**
- **Credential stuffing on customer accounts**

## Data Flows

### 1. Customer -> Mobile App: Tap 'Checkout'

**Description:**
User initiates the checkout process from their cart.

### 2. Mobile App -> API Gateway: Submit Payment
- **Data Exchanged:** AuthToken, OrderTotal, CardDetails
- **Identified Threats:**
  - Man-in-the-Middle (MITM) if TLS is bypassed or downgraded

**Description:**
Encrypted payload sent over TLS.

### 3. API Gateway -> Payment Microservice: Route Request
- **Data Exchanged:** CardDetails

### 4. Payment Microservice -> External Payment Gateway: Process Charge
- **Data Exchanged:** Amount, CardDetails
- **Identified Threats:**
  - Third-party API outage
  - API key leakage

**Description:**
External API call to clear the funds.

### 5. External Payment Gateway -> Payment Microservice: Charge Result
- **Data Exchanged:** TransactionID, Status

### 6. Payment Microservice -> Orders Database: Update Order
- **Data Exchanged:** OrderID, Status&lt;sub&gt;payment&lt;/sub&gt;
- **Identified Threats:**
  - SQL Injection during record update

**Description:**
Mark the order as paid in the database.

### 7. Payment Microservice -> Mobile App: Return Receipt
- **Data Exchanged:** Receipt HTML


## STRIDE Overview

STRIDE is a threat-modeling mnemonic for common security risks. Each letter highlights a different category of attack or weakness.

| Letter | Meaning | Description |
|---|---|---|
| S | Spoofing | pretending to be another user, system, or service. |
| T | Tampering | modifying data or code in transit or at rest. |
| R | Repudiation | denying that an action occurred without proof. |
| I | Information disclosure | exposing data to those without permission. |
| D | Denial of service | disrupting or degrading service availability. |
| E | Elevation of privilege | gaining access beyond what was intended. |

