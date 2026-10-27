<?xml version="1.0" encoding="UTF-8"?>
<!--
  Test excerpt for the standards compiler's currency count (T2b, 2026-10-03): the lines below are copied byte for byte from the
  CEN EN16931 UBL schematron (v1.3.15, licensed under the European Union Public Licence 1.2), as published in
  OpenPEPPOL/peppol-bis-invoice-3 at commit 261c458474e27d58a25be629cccac28883171c92 (rules/sch/CEN-EN16931-UBL.sch, sha256
  bdcbb7b702cce55c7f8c789bef0cb9bebf6d376140c1776e683bd6d9bc0ad331).
  Source lines 7-16, 23, 79, 90 and 96 (the document rule, cut to BR-53 and BR-CO-15); the closing tags are added here.
-->
<!--Schematron version 1.3.15 - Last update: 2025-10-16--><schema xmlns="http://purl.oclc.org/dsdl/schematron" queryBinding="xslt2">
  <title>EN16931  model bound to UBL</title>
  <ns prefix="ext" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" />
  <ns prefix="cbc" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" />
  <ns prefix="cac" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" />
  <ns prefix="qdt" uri="urn:oasis:names:specification:ubl:schema:xsd:QualifiedDataTypes-2" />
  <ns prefix="udt" uri="urn:oasis:names:specification:ubl:schema:xsd:UnqualifiedDataTypes-2" />
  <ns prefix="cn" uri="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" />
  <ns prefix="ubl" uri="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" />
  <ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema" />
  <pattern id="UBL-model">
    <rule context="/ubl:Invoice | /cn:CreditNote">
      <assert id="BR-53" flag="fatal" test="every $taxcurrency in cbc:TaxCurrencyCode satisfies exists(//cac:TaxTotal/cbc:TaxAmount[@currencyID=$taxcurrency])">[BR-53]-If the VAT accounting currency code (BT-6) is present, then the Invoice total VAT amount in accounting currency (BT-111) shall be provided.</assert>
      <assert id="BR-CO-15" flag="fatal" test="every $Currency in cbc:DocumentCurrencyCode satisfies (count(cac:TaxTotal/xs:decimal(cbc:TaxAmount[@currencyID=$Currency])) eq 1) and (cac:LegalMonetaryTotal/xs:decimal(cbc:TaxInclusiveAmount) = round( (cac:LegalMonetaryTotal/xs:decimal(cbc:TaxExclusiveAmount) + cac:TaxTotal/xs:decimal(cbc:TaxAmount[@currencyID=$Currency])) * 10 * 10) div 100)">[BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).</assert>
    </rule>
  </pattern>
</schema>
