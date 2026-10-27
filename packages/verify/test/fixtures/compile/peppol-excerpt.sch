<?xml version="1.0" encoding="UTF-8"?>
<!--
  Test excerpt for the standards compiler: the lines below are copied byte for byte from the Peppol BIS Billing 3.0
  schematron (release 3.0.20), OpenPEPPOL/peppol-bis-invoice-3 at commit 261c458474e27d58a25be629cccac28883171c92
  (rules/sch/PEPPOL-EN16931-UBL.sch, sha256 5ddf3a2f6633147b20b7805df9902d825af1a984f10014fcee186d4170364b1d); it uses
  business terms of CEN EN 16931-1, reproduced there with permission from CEN. Source lines 9-17, 52, 63-68, 343-347 and
  360-413; the pattern and closing tags around them are added here.
-->
<schema xmlns="http://purl.oclc.org/dsdl/schematron" xmlns:u="utils" schemaVersion="iso"
  queryBinding="xslt2">
  <title>Rules for Peppol BIS 3.0 Billing</title>
  <ns uri="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" prefix="cbc" />
  <ns uri="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" prefix="cac" />
  <ns uri="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" prefix="ubl-creditnote" />
  <ns uri="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" prefix="ubl-invoice" />
  <ns uri="http://www.w3.org/2001/XMLSchema" prefix="xs" />
  <ns uri="utils" prefix="u" />
  <let name="documentCurrencyCode" value="/*/cbc:DocumentCurrencyCode" />
  <function xmlns="http://www.w3.org/1999/XSL/Transform" name="u:slack" as="xs:boolean">
    <param name="exp" as="xs:decimal" />
    <param name="val" as="xs:decimal" />
    <param name="slack" as="xs:decimal" />
    <sequence select="xs:decimal($exp + $slack) &gt;= $val and xs:decimal($exp - $slack) &lt;= $val" />
  </function>
  <pattern>
    <!-- Currency -->
    <rule
      context="cbc:Amount | cbc:BaseAmount | cbc:PriceAmount | cac:TaxTotal[cac:TaxSubtotal]/cbc:TaxAmount | cac:TaxSubtotal/cbc:TaxAmount | cbc:TaxableAmount | cbc:LineExtensionAmount | cbc:TaxExclusiveAmount | cbc:TaxInclusiveAmount | cbc:AllowanceTotalAmount | cbc:ChargeTotalAmount | cbc:PrepaidAmount | cbc:PayableRoundingAmount | cbc:PayableAmount">
      <assert id="PEPPOL-EN16931-R051" test="@currencyID = $documentCurrencyCode" flag="fatal">All currencyID attributes must have the same value as the invoice currency code (BT-5), except for the invoice total VAT amount in accounting currency (BT-111).</assert>
    </rule>
    <rule context="cac:InvoiceLine | cac:CreditNoteLine">
      <let name="lineExtensionAmount"
        value="
          if (cbc:LineExtensionAmount) then
            xs:decimal(cbc:LineExtensionAmount)
          else
            0" />
      <let name="quantity"
        value="
          if (/ubl-invoice:Invoice) then
            (if (cbc:InvoicedQuantity) then
              xs:decimal(cbc:InvoicedQuantity)
            else
              1)
          else
            (if (cbc:CreditedQuantity) then
              xs:decimal(cbc:CreditedQuantity)
            else
              1)" />
      <let name="priceAmount"
        value="
          if (cac:Price/cbc:PriceAmount) then
            xs:decimal(cac:Price/cbc:PriceAmount)
          else
            0" />
      <let name="baseQuantity"
        value="
          if (cac:Price/cbc:BaseQuantity and xs:decimal(cac:Price/cbc:BaseQuantity) != 0) then
            xs:decimal(cac:Price/cbc:BaseQuantity)
          else
            1" />
      <let name="allowancesTotal"
        value="
          if (cac:AllowanceCharge[normalize-space(cbc:ChargeIndicator) = 'false']) then
            round(sum(cac:AllowanceCharge[normalize-space(cbc:ChargeIndicator) = 'false']/cbc:Amount/xs:decimal(.)) * 10 * 10) div 100
          else
            0" />
      <let name="chargesTotal"
        value="
          if (cac:AllowanceCharge[normalize-space(cbc:ChargeIndicator) = 'true']) then
            round(sum(cac:AllowanceCharge[normalize-space(cbc:ChargeIndicator) = 'true']/cbc:Amount/xs:decimal(.)) * 10 * 10) div 100
          else
            0" />
      <assert id="PEPPOL-EN16931-R120"
        test="u:slack($lineExtensionAmount, ($quantity * ($priceAmount div $baseQuantity)) + $chargesTotal - $allowancesTotal, 0.02)"
        flag="fatal">Invoice line net amount MUST equal (Invoiced quantity * (Item net price/item price base quantity) + Sum of invoice line charge amount - sum of invoice line allowance amount</assert>
      <assert id="PEPPOL-EN16931-R121"
        test="not(cac:Price/cbc:BaseQuantity) or xs:decimal(cac:Price/cbc:BaseQuantity) &gt; 0"
        flag="fatal">Base quantity MUST be a positive number above zero.</assert>
      <assert id="PEPPOL-EN16931-R100" test="(count(cac:DocumentReference) &lt;= 1)" flag="fatal">Only one invoiced object is allowed pr line</assert>
      <assert id="PEPPOL-EN16931-R101"
        test="(not(cac:DocumentReference) or (cac:DocumentReference/cbc:DocumentTypeCode='130'))"
        flag="fatal">Element Document reference can only be used for Invoice line object</assert>
    </rule>
  </pattern>
</schema>
