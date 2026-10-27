<?xml version="1.0" encoding="UTF-8"?>
<!--
  Test excerpt for the standards compiler: the lines below are copied byte for byte from the CEN EN16931 UBL schematron
  (v1.3.15, licensed under the European Union Public Licence 1.2), as published in OpenPEPPOL/peppol-bis-invoice-3 at commit
  261c458474e27d58a25be629cccac28883171c92 (rules/sch/CEN-EN16931-UBL.sch, sha256 bdcbb7b702cce55c7f8c789bef0cb9bebf6d376140c1776e683bd6d9bc0ad331).
  Source lines 7-16, 27-29, 60-86 (the document rule cut after BR-07), 173-176, 219-221, 391-392 (cut after UBL-CR-001) and
  1157-1159; the pattern tags and the closing tags of the two cut rules are added here.
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
    <rule context="/ubl:Invoice/cac:LegalMonetaryTotal/cbc:PayableAmount">
      <assert id="BR-CO-25" flag="fatal" test="((. > 0) and (exists(//cbc:DueDate) or exists(//cac:PaymentTerms/cbc:Note))) or (. &lt;= 0)">[BR-CO-25]-In case the Amount due for payment (BT-115) is positive, either the Payment due date (BT-9) or the Payment terms (BT-20) shall be present.</assert>
    </rule>
    <rule context="cac:LegalMonetaryTotal">
      <assert id="BR-12" flag="fatal" test="exists(cbc:LineExtensionAmount)">[BR-12]-An Invoice shall have the Sum of Invoice line net amount (BT-106).</assert>
      <assert id="BR-13" flag="fatal" test="exists(cbc:TaxExclusiveAmount)">[BR-13]-An Invoice shall have the Invoice total amount without VAT (BT-109).</assert>
      <assert id="BR-14" flag="fatal" test="exists(cbc:TaxInclusiveAmount)">[BR-14]-An Invoice shall have the Invoice total amount with VAT (BT-112).</assert>
      <assert id="BR-15" flag="fatal" test="exists(cbc:PayableAmount)">[BR-15]-An Invoice shall have the Amount due for payment (BT-115).</assert>
      <assert id="BR-CO-10" flag="fatal" test="(xs:decimal(cbc:LineExtensionAmount) = xs:decimal(round(sum(//(cac:InvoiceLine|cac:CreditNoteLine)/xs:decimal(cbc:LineExtensionAmount)) * 10 * 10) div 100))">[BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).</assert>
      <assert id="BR-CO-11" flag="fatal" test="xs:decimal(cbc:AllowanceTotalAmount) = (round(sum(../cac:AllowanceCharge[cbc:ChargeIndicator=false()]/xs:decimal(cbc:Amount)) * 10 * 10) div 100) or  (not(cbc:AllowanceTotalAmount) and not(../cac:AllowanceCharge[cbc:ChargeIndicator=false()]))">[BR-CO-11]-Sum of allowances on document level (BT-107) = Σ Document level allowance amount (BT-92).</assert>
      <assert id="BR-CO-12" flag="fatal" test="xs:decimal(cbc:ChargeTotalAmount) = (round(sum(../cac:AllowanceCharge[cbc:ChargeIndicator=true()]/xs:decimal(cbc:Amount)) * 10 * 10) div 100) or (not(cbc:ChargeTotalAmount) and not(../cac:AllowanceCharge[cbc:ChargeIndicator=true()]))">[BR-CO-12]-Sum of charges on document level (BT-108) = Σ Document level charge amount (BT-99).</assert>
      <assert id="BR-CO-13" flag="fatal" test="((cbc:ChargeTotalAmount) and (cbc:AllowanceTotalAmount) and (xs:decimal(cbc:TaxExclusiveAmount) = round((xs:decimal(cbc:LineExtensionAmount) + xs:decimal(cbc:ChargeTotalAmount) - xs:decimal(cbc:AllowanceTotalAmount)) * 10 * 10) div 100 ))  or (not(cbc:ChargeTotalAmount) and (cbc:AllowanceTotalAmount) and (xs:decimal(cbc:TaxExclusiveAmount) = round((xs:decimal(cbc:LineExtensionAmount) - xs:decimal(cbc:AllowanceTotalAmount)) * 10 * 10 ) div 100)) or ((cbc:ChargeTotalAmount) and not(cbc:AllowanceTotalAmount) and (xs:decimal(cbc:TaxExclusiveAmount) = round((xs:decimal(cbc:LineExtensionAmount) + xs:decimal(cbc:ChargeTotalAmount)) * 10 * 10 ) div 100)) or (not(cbc:ChargeTotalAmount) and not(cbc:AllowanceTotalAmount) and (xs:decimal(cbc:TaxExclusiveAmount) = xs:decimal(cbc:LineExtensionAmount)))">[BR-CO-13]-Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of allowances on document level (BT-107) + Sum of charges on document level (BT-108).</assert>
      <assert id="BR-CO-16" flag="fatal" test="(exists(cbc:PrepaidAmount) and not(exists(cbc:PayableRoundingAmount)) and (xs:decimal(cbc:PayableAmount) = (round((xs:decimal(cbc:TaxInclusiveAmount) - xs:decimal(cbc:PrepaidAmount)) * 10 * 10) div 100))) or (not(exists(cbc:PrepaidAmount)) and not(exists(cbc:PayableRoundingAmount)) and xs:decimal(cbc:PayableAmount) = xs:decimal(cbc:TaxInclusiveAmount)) or (exists(cbc:PrepaidAmount) and exists(cbc:PayableRoundingAmount) and ((round((xs:decimal(cbc:PayableAmount) - xs:decimal(cbc:PayableRoundingAmount)) * 10 * 10) div 100) = (round((xs:decimal(cbc:TaxInclusiveAmount) - xs:decimal(cbc:PrepaidAmount)) * 10 * 10) div 100))) or  (not(exists(cbc:PrepaidAmount)) and exists(cbc:PayableRoundingAmount) and ((round((xs:decimal(cbc:PayableAmount) - xs:decimal(cbc:PayableRoundingAmount)) * 10 * 10) div 100) = xs:decimal(cbc:TaxInclusiveAmount)))">[BR-CO-16]-Amount due for payment (BT-115) = Invoice total amount with VAT (BT-112) -Paid amount (BT-113) +Rounding amount (BT-114).</assert>
      <assert id="BR-DEC-09" flag="fatal" test="string-length(substring-after(cbc:LineExtensionAmount,'.'))&lt;=2">[BR-DEC-09]-The allowed maximum number of decimals for the Sum of Invoice line net amount (BT-106) is 2.</assert>
      <assert id="BR-DEC-10" flag="fatal" test="string-length(substring-after(cbc:AllowanceTotalAmount,'.'))&lt;=2">[BR-DEC-10]-The allowed maximum number of decimals for the Sum of allowanced on document level (BT-107) is 2.</assert>
      <assert id="BR-DEC-11" flag="fatal" test="string-length(substring-after(cbc:ChargeTotalAmount,'.'))&lt;=2">[BR-DEC-11]-The allowed maximum number of decimals for the Sum of charges on document level (BT-108) is 2.</assert>
      <assert id="BR-DEC-12" flag="fatal" test="string-length(substring-after(cbc:TaxExclusiveAmount,'.'))&lt;=2">[BR-DEC-12]-The allowed maximum number of decimals for the Invoice total amount without VAT (BT-109) is 2.</assert>
      <assert id="BR-DEC-14" flag="fatal" test="string-length(substring-after(cbc:TaxInclusiveAmount,'.'))&lt;=2">[BR-DEC-14]-The allowed maximum number of decimals for the Invoice total amount with VAT (BT-112) is 2.</assert>
      <assert id="BR-DEC-16" flag="fatal" test="string-length(substring-after(cbc:PrepaidAmount,'.'))&lt;=2">[BR-DEC-16]-The allowed maximum number of decimals for the Paid amount (BT-113) is 2.</assert>
      <assert id="BR-DEC-17" flag="fatal" test="string-length(substring-after(cbc:PayableRoundingAmount,'.'))&lt;=2">[BR-DEC-17]-The allowed maximum number of decimals for the Rounding amount (BT-114) is 2.</assert>
      <assert id="BR-DEC-18" flag="fatal" test="string-length(substring-after(cbc:PayableAmount,'.'))&lt;=2">[BR-DEC-18]-The allowed maximum number of decimals for the Amount due for payment (BT-115) is 2.  </assert>
    </rule>
    <rule context="/ubl:Invoice | /cn:CreditNote">
      <assert id="BR-01" flag="fatal" test="normalize-space(cbc:CustomizationID) != ''">[BR-01]-An Invoice shall have a Specification identifier (BT-24).   </assert>
      <assert id="BR-02" flag="fatal" test="normalize-space(cbc:ID) != ''">[BR-02]-An Invoice shall have an Invoice number (BT-1).</assert>
      <assert id="BR-03" flag="fatal" test="normalize-space(cbc:IssueDate) != ''">[BR-03]-An Invoice shall have an Invoice issue date (BT-2).</assert>
      <assert id="BR-04" flag="fatal" test="normalize-space(cbc:InvoiceTypeCode) != '' or normalize-space(cbc:CreditNoteTypeCode) !=''">[BR-04]-An Invoice shall have an Invoice type code (BT-3).</assert>
      <assert id="BR-05" flag="fatal" test="normalize-space(cbc:DocumentCurrencyCode) != ''">[BR-05]-An Invoice shall have an Invoice currency code (BT-5).</assert>
      <assert id="BR-06" flag="fatal" test="normalize-space(cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName) != ''">[BR-06]-An Invoice shall contain the Seller name (BT-27).</assert>
      <assert id="BR-07" flag="fatal" test="normalize-space(cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:RegistrationName) != ''">[BR-07]-An Invoice shall contain the Buyer name (BT-44).</assert>
    </rule>
    <rule context="cac:InvoicePeriod">
      <assert id="BR-29" flag="fatal" test="(exists(cbc:EndDate) and exists(cbc:StartDate) and xs:date(cbc:EndDate) >= xs:date(cbc:StartDate)) or not(exists(cbc:StartDate)) or not(exists(cbc:EndDate))">[BR-29]-If both Invoicing period start date (BT-73) and Invoicing period end date (BT-74) are given then the Invoicing period end date (BT-74) shall be later or equal to the Invoicing period start date (BT-73).</assert>
      <assert id="BR-CO-19" flag="fatal" test="exists(cbc:StartDate) or exists(cbc:EndDate) or (exists(cbc:DescriptionCode) and not(exists(cbc:StartDate)) and not(exists(cbc:EndDate)))">[BR-CO-19]-If Invoicing period (BG-14) is used, the Invoicing period start date (BT-73) or the Invoicing period end date (BT-74) shall be filled, or both.</assert>
    </rule>
    <rule context="/ubl:Invoice/cac:TaxTotal | /cn:CreditNote/cac:TaxTotal">
      <assert id="BR-CO-14" flag="fatal" test="(xs:decimal(child::cbc:TaxAmount)= round((sum(cac:TaxSubtotal/xs:decimal(cbc:TaxAmount)) * 10 * 10)) div 100) or not(cac:TaxSubtotal)">[BR-CO-14]-Invoice total VAT amount (BT-110) = Σ VAT category tax amount (BT-117).</assert>
    </rule>
  </pattern>
  <pattern id="UBL-syntax">
    <rule context="/ubl:Invoice | /cn:CreditNote">
      <assert id="UBL-CR-001" flag="warning" test="not(ext:UBLExtensions)">[UBL-CR-001]-A UBL invoice should not include extensions</assert>
    </rule>
  </pattern>
  <pattern id="Codesmodel">
    <rule flag="fatal" context="cbc:DocumentCurrencyCode">
      <assert id="BR-CL-04" flag="fatal" test="((not(contains(normalize-space(.), ' ')) and contains(' AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNH CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STD SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VES VED VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWG ', concat(' ', normalize-space(.), ' '))))">[BR-CL-04]-Invoice currency code MUST be coded using ISO code list 4217 alpha-3</assert>
    </rule>
  </pattern>
</schema>
