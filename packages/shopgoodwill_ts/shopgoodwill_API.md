## **ShopGoodwill.com Unofficial REST API Specification**

This document provides a comprehensive, reverse-engineered reference for the unofficial internal REST API powering ShopGoodwill.com. It is designed to guide the development of a structured TypeScript client library.

## ---

**1\. Overview**

> *   
> * **Base URL:** https://buyerapi.shopgoodwill.com/api  
> * **Protocol:** HTTPS only  
> * **Data Format:** application/json for both requests and responses. \[1, 2\]  
> * 

## **Global Headers & Conventions**

While the API behaves like a traditional REST interface, it has an unexpected architecture regarding session state. \[3\]

| Header | Value / Description | Required For |
| :---- | :---- | :---- |
| Content-Type | application/json | All POST requests |
| Authorization | Bearer \<JWT\_TOKEN\> | Authenticated endpoints (Bidding, Watchlist) |
| User-Agent | Mimic a standard desktop browser | All requests (to bypass potential WAF rules) |

## **⚠️ Cookie Quirks & 403 Forbidden Errors**

Reverse engineering notes from scottmconway/shopgoodwill-scripts indicate that if a client accepts and presents HTTP cookies returned by the buyerapi.shopgoodwill.com domain, consecutive authenticated calls (such as successive bidding actions) will frequently fail with an unexpected 403 Client Error: Forbidden. \[3\]

**Implementation Rule:** Your TypeScript client library must completely ignore/drop incoming Set-Cookie headers from the API domain and manage session context strictly via the Authorization: Bearer header. \[3\]

## ---

**2\. Authentication**

Authentication leverages standard JSON Web Tokens (JWT) passed in the HTTP headers. However, the payloads delivered to the login endpoint must be obfuscated via AES encryption. \[1, 4\]

## **Client-Side Obfuscation Cipher**

Before sending user credentials, they must be encrypted with static parameters hardcoded inside the official web front end: \[1\]

> *   
> * **Algorithm:** AES-128-CBC  
> * **Key (Hex):** 6696D2E6F042FEC4D6E3F32AD541143B  
> * **IV (Hex):** 0000000000000000  
> * **Encoding:** The output binary is converted to Base64 and then strictly **URL-encoded** before assembly into the JSON string payload (preserving characters like %). \[1, 4\]  
> * 

## **Endpoint: Authentication Login**

> *   
> * **Method:** POST  
> * **Path:** /SignIn/Login  
> * **Auth Requirement:** None \[4, 5\]  
> * 

## **Request Body Schema**

{  
  "userName": "AES\_CBC\_URL\_ENCODED\_STRING",  
  "password": "AES\_CBC\_URL\_ENCODED\_STRING",  
  "remember": false,  
  "appVersion": "00099a1be3bb023ff17d",  
  "clientIpAddress": "0.0.0.4",  
  "browser": "firefox"  
}

> *   
> * appVersion: *Inferred* to track software releases. Use the latest string discovered from live network traffic inspection.  
> * clientIpAddress: Frequently hardcoded or spoofed as 0.0.0.4 without breaking compliance. \[4\]  
> * 

## **Response Body Schema**

Returns a payload containing the JSON Web Token. The string provided inside the token value is subsequently extracted and appended to consecutive requests as Authorization: Bearer \<Token\>.

## ---

**3\. Endpoints**

## **3.1 Search & Discovery**

## **Endpoint: Advanced Listing Search**

> *   
> * **Method:** POST  
> * **Path:** /Search/ItemListing  
> * **Auth Requirement:** None \[2\]  
> * 

Used for filtering, category sorting, and text query matching across live auctions. \[2\]

## **Request Body Schema (Derived Filter Object)**

The full JSON object contains a large footprint matching the site's Advanced Search UI. The following keys are confirmed valid: \[2\]

| Key | Type | Description |
| :---- | :---- | :---- |
| searchText | string | The string query. Note: Adding literal quotation marks around strings mimics advanced structural matching on title contents natively filtered by third-party tooling. |
| searchOneCentShippingOnly | boolean | Limits results exclusively to $0.01 promotional shipping. |
| category | number | Numeric Category ID identifier mapped via directory indexing. |
| page | number | Index page offset tracking (overridden inside dynamic loop script runners). |
| pageSize | number | Result size definition limit per individual payload. |

## **Response Body Schema**

{  
  "items": \[  
    {  
      "itemid": 123456,  
      "title": "Example Item Title",  
      "currentPrice": 15.00,  
      "endTime": "2026-09-20T12:00:00Z"  
    }  
  \],  
  "result\_count": 450  
}

## ---

**3.2 Product Details & Logistics**

## **Endpoint: Item Metadata Scraping**

> *   
> * **Method:** GET or POST (*Source mapping implies parameter collection, potentially combined via dynamic path structures*)  
> * **Purpose:** Resolves item description, historical activity context, handling fees, and structural weights.  
> * **Auth Requirement:** None  
> * 

## **Endpoint: Shipping Quote Estimation**

> *   
> * **Method:** POST  
> * **Auth Requirement:** None  
> * **Purpose:** Allows calculation of exact target carriage pricing dynamically assigned by discrete regional Goodwill fulfillment centers.  
> * 

## **Request Body Schema**

{  
  "itemId": "123456",  
  "zipCode": "20500"  
}

## **Response Body Schema**

{  
  "shipping": {  
    "shipping": 8.50,  
    "handling": 2.00,  
    "total": 10.50  
  }  
}

## ---

**3.3 Bidding & Watchlist Operations**

## **Endpoint: Place Proxy or Snipe Bid**

> *   
> * **Method:** POST  
> * **Path:** /ItemBid/PlaceBid  
> * **Auth Requirement:** Bearer Token \[3\]  
> * 

## **Request Body Schema**

{  
  "itemId": 123456,  
  "bidAmount": 45.50  
}

## **Endpoint: Account Favorites Tracker**

> *   
> * **Purpose:** Pulls down user-configured active items tagged with the "Heart" UI save marker.  
> * **Auth Requirement:** Bearer Token  
> * **Special Convention:** The API maps custom user annotations (such as a 500-character description field) directly onto this payload. Automated bidding platforms inject standardized string expressions here (e.g., {"max\_bid": 10.5}) to instruct processing engines without setting up secondary remote databases.  
> * 

## ---

**4\. Open Questions & Gaps**

> *   
> * **Handling Fee Variations:** The precise format structure of item details payloads (specifically regarding multi-item lots or variations in regional warehouse storage handling) remains unconfirmed.  
> * **Rate Limits:** While explicit rate limits are not officially stated, known tools introduce configurable delay sleeps (sleeps (int)) between scraping item-level extensions to avoid trigger thresholds.  
> * **Saved Searches API:** The saved\_searches parameter relies on account context conversion logic within the browser application that has not been completely reverse-engineered. The local representation using raw JSON configurations bypasses this gap reliably.  
> * 

## ---

**5\. Sources**

> *   
> * scottmconway/shopgoodwill-scripts Repository  
> * abarran02/ShopGoodwill Repository  
> * Blog Post: Reverse Engineering ShopGoodwill for Fun and Profit  
> * ShopGoodwill Scripts Project Issue Tracker \- \#28 Session Bug Analysis \[3, 4\]  
> * 

Would you like assistance in drafting the **TypeScript interfaces** for these JSON request payloads or generating a template for the **AES-128-CBC obfuscation utility module**?

\[1\] [https://github.com](https://github.com/scottmconway/shopgoodwill-scripts/blob/main/shopgoodwill.py)  
\[2\] [https://github.com](https://github.com/scottmconway/shopgoodwill-scripts)  
\[3\] [https://github.com](https://github.com/scottmconway/shopgoodwill-scripts/issues/28)  
\[4\] [https://conway.scot](https://conway.scot/shopgoodwill-reversing/)  
\[5\] [https://github.com](https://github.com/scottmconway/shopgoodwill-scripts)