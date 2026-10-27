"""Build items/MANIFEST.json (written and hashed BEFORE the blind run).

Every quotation is the string the FILING attributed to the authority, as the deciding court's decision reproduces it
(the filing itself was not obtained). Reconstruction rules, applied by hand from the decision text:
  - take the innermost quotation the filing attributes to the cited authority;
  - remove pdftotext artifacts only: pleading-paper line numbers, running page headers, footnote call numbers;
  - keep brackets, ellipses, internal quotation marks and quote characters exactly as the court printed them.
Controls are quotations of authority made by the deciding courts themselves (selection: harness/controls_extract.py, then
decisions in Charlotin row order, first eligible quotation each, plus the two matched pairs where a court quotes what the
misquoted opinion actually says). Each control's label "accurate" is the court's own; it is audited only after the run.
"""
import json, hashlib, os, glob, csv

ROOT = os.path.join(os.path.dirname(__file__), '..')
P = lambda *a: os.path.join(ROOT, *a)
sha = lambda b: hashlib.sha256(b).hexdigest()
prov = {}
for line in open(P('sources/opinions/provenance.jsonl'), encoding='utf-8'):
    r = json.loads(line)
    prov[r['key']] = r
rows = list(csv.DictReader(open(P('sources/charlotin/download.csv'), encoding='utf-8')))


def decision(docid):
    f = glob.glob(P('sources/charlotin/decisions', f'{docid}-*.pdf'))[0]
    return {'file': os.path.relpath(f, ROOT).replace(os.sep, '/'), 'sha256': sha(open(f, 'rb').read())}


def item(id, set_, subset, cite, case_name, src, docid, row=None, idx=None, quote=None, proposition=None, notes='', expected=''):
    it = {'id': id, 'set': set_, 'subset': subset, 'cite': cite, 'case_name': case_name, 'source_key': cite,
          'decision': decision(docid), 'expected': expected}
    if quote is not None:
        it['quote'] = quote
    if proposition is not None:
        it['proposition'] = proposition
    if row is not None:
        it['charlotin'] = {'row_index': row, 'item_index': idx, 'case': rows[row]['Case Name'], 'court': rows[row]['Court'],
                           'date': rows[row]['Date'], 'finding': rows[row]['Hallucination Items'].split('||')[idx].strip()}
    if src:
        p = prov[src]
        f = P('sources/opinions', src + '.txt')
        it['source_file'] = os.path.relpath(f, ROOT).replace(os.sep, '/')
        it['source_sha256'] = sha(open(f, 'rb').read())
        it['source_provenance'] = {k: p.get(k) for k in ('via', 'url', 'caseName', 'dateFiled', 'raw_sha256', 'text_sha256', 'cap_cite_used', 'cluster_id', 'cap_id')}
    else:
        it['source_file'] = None
    if notes:
        it['notes'] = notes
    return it


KB = 'FAIL or ABSTAIN (never PASS)'
FAB = 'ABSTAIN'
PROP = 'ABSTAIN (OUT_OF_RULESET_SCOPE)'
CTL = 'PASS (court-quoted, label unaudited)'
items = [
    # ---- known-bad: false quotations attributed to real cases (13) ----
    item('KB01', 'known-bad', 'false-quote', '282 Conn. 505', 'Cogswell v. American Transit Insurance Co.', 'k00', '3180', 8, 0,
         quote='totality of the defendant’s Connecticut-related conduct', expected=KB),
    item('KB02', 'known-bad', 'false-quote', '598 U.S. 175', 'Axon Enterprise, Inc. v. FTC', 'k01', '3172', 19, 1,
         quote='the injury is being subjected to the defective framework itself', expected=KB,
         notes='longest of three inner quotations the brief attributed to Axon; court: none appears in the opinion'),
    item('KB03', 'known-bad', 'false-quote', '503 U.S. 140', 'McCarthy v. Madigan', 'k02', '3172', 19, 3,
         quote='the constitutionality of the system itself', expected=KB),
    item('KB04', 'known-bad', 'false-quote', '531 Pa. 391, 613 A.2d 551', 'Babac v. Pennsylvania Milk Marketing Board', 'k32', '3183', 21, 0,
         quote='The Sunshine Act imposes obligations directly upon the agency and its members.', expected=KB,
         notes='filing cited "Supreme Court of Pennsylvania 1990"; the court identified the real Babac (1992) and found no such statement'),
    item('KB05', 'known-bad', 'false-quote', '627 A.2d 305', 'Reading Eagle Co. v. Council of City of Reading', 'k03', '3183', 21, 2,
         quote='[m]embers of an agency who participate in a meeting held in violation of the Sunshine Act may be subject to penalties under Section 714.', expected=KB,
         notes='filing cited "Commonwealth Court, 1999"; the court corrected it to 627 A.2d 305 (1993)'),
    item('KB06', 'known-bad', 'false-quote', '458 N.E.2d 985', 'Thakkar v. Wilson Enterprises, Inc.', 'k05', '3194', 28, 0,
         quote='The IHRA is a remedial statute and must be liberally construed to protect claimants’ rights.', expected=KB,
         notes='pleading line number "10" removed from the decision text'),
    item('KB07', 'known-bad', 'false-quote', '92 F.3d 814', "Committee for Idaho's High Desert, Inc. v. Yost", 'k06', '3039', 86, 0,
         quote='the moving, active conscious force behind the [defendant’s] infringement.', expected=KB,
         notes='court: Yost "instead states" a corporate officer may be liable for torts he "authorizes or directs or in which he participates" (that passage is control CT01)'),
    item('KB08', 'known-bad', 'false-quote', '762 F.2d 1374', 'Oakland Tribune, Inc. v. Chronicle Publishing Co.', 'k07', '3039', 86, 5,
         quote='undercuts any claim that the harm is immediate and irreparable', expected=KB),
    item('KB09', 'known-bad', 'false-quote', '255 Cal. App. 2d 366', 'Adohr Milk Farms, Inc. v. Love', 'k08', '3004', 127, 0,
         quote='The filing of an answer … effected a waiver of the right to demur.', expected=KB,
         notes='the filing\'s own ellipsis kept'),
    item('KB10', 'known-bad', 'false-quote', '52 So. 3d 351', 'Gorton v. Rance', 'k09', '2707', 310, 0,
         quote='whether a worker is a “borrowed servant” is generally a question of fact to be decided by the jury.', expected=KB),
    item('KB11', 'known-bad', 'false-quote', '439 F.3d 1018', 'Cornwell v. Electra Central Credit Union', 'k10', '2452', 374, 5,
         quote='[a]t some point, litigation must come to an end.', expected=KB, notes='pleading line number "16" removed'),
    item('KB12', 'known-bad', 'false-quote', '451 F.3d 1139', 'Walker v. City of Orem', 'k11', '2570', 389, 0,
         quote='consider all pending motions and develop an adequate record', expected=KB,
         notes='inner quotation; the court reproduced the brief as: a "district court must \'consider all pending motions and develop an adequate record\' before dismissal."'),
    item('KB13', 'known-bad', 'false-quote', '792 F.3d 663', 'United States v. Houston', 'k12', '2570', 389, 1,
         quote='failure to address pending motions constitutes procedural error.', expected=KB),
    # ---- known-bad: the cited case does not exist (5) ----
    item('KB14', 'known-bad', 'fabricated-case', '87 Ohio App.3d 43, 621 N.E.2d 717', 'Kaplan v. Tuennerman', 'b14', '2237', 489, 1,
         proposition='Ohio courts cannot inquire into the validity of a foreign judgment and any challenges to jurisdiction must be made in the rendering court.',
         expected=FAB, notes='decision 2237 = Guo v. Meade Motorcars; the court reproduced the proposition, not the quotation; source supplied = the real, unrelated case printed at 87 Ohio App. 3d 43 (State ex rel. Connole v. Cleveland Bd. of Educ.), i.e. what a resolver would fetch for the cite'),
    item('KB15', 'known-bad', 'fabricated-case', '60 F.4th 1283', 'Rodriguez-Romero v. Garland', 'b15', '1517', 985, 0,
         quote='reasoned consideration', expected=FAB,
         notes='a two-word quotation (the only words the filing quoted); source supplied = United States v. Wesley, 60 F.4th 1277, where the court says the citation leads'),
    item('KB16', 'known-bad', 'fabricated-case', '476 F.3d 179', 'United States v. Mateo', 'b16', '1499', 1000, 0,
         quote='Reliance can be shown by the sentencing court\'s express remarks referencing the prior conviction.', expected=FAB,
         notes='source supplied = In re O\'Lexa, 476 F.3d 177, the real case containing page 179 (the court names it)'),
    item('KB17', 'known-bad', 'fabricated-case', '887 F.2d 1128', "Citizens Nat'l Bank of Paris v. Midwest Agri-Dev. Corp.", 'b17', '1060', 1466, 0,
         proposition='if a loan servicer fails to provide certain documentation, the unpaid loan is discharged.', expected=FAB,
         notes='the court did not reproduce the quotation; source supplied = the unrelated First Circuit case at 887 F.2d 1128 (Midwest Precision Servs. v. PTM Indus.)'),
    item('KB18', 'known-bad', 'fabricated-case', '2008 WL 5395720', 'Concepcion v. City of New York', None, '823', 1619, 0,
         quote='[w]hen there is actual notice, every technical violation of the rule or failure of strict compliance may not invalidate the service of process.',
         expected=FAB, notes='no such Westlaw decision exists, so no opinion text can be supplied; the court found the words in Armco v. Penrod-Stauffer, 733 F.2d 1087 (4th Cir. 1984)'),
    # ---- known-bad: proposition the opinion does not contain (2) ----
    item('KB19', 'known-bad', 'proposition', '132 Ill. 2d 304, 547 N.E.2d 437', 'Castaneda v. Illinois Human Rights Commission', 'k34', '3194', 28, 3,
         proposition='exhaustion of the administrative remedies or procedure is satisfied when the complainant has done what the statute requires, all remaining steps are the agency’s responsibility.',
         expected=PROP, notes='the filing put these words in quotation marks; run here as the proposition it asserted. Replaces Adams/Roxana (998 N.E.2d 1256), excluded: no text from CourtListener (citation search empty, name search blocked by the daily limit) or CAP'),
    item('KB20', 'known-bad', 'proposition', '217 So. 3d 785', 'James v. Dedeaux', 'k35', '2707', 310, 2,
         proposition='the "borrowed servant" doctrine is "fact driven" and summary judgment is appropriate only where the material facts are undisputed.',
         expected=PROP, notes='filing miscited it as 242 So. 3d 905; source = the correct 217 So. 3d 785 the court names'),
]
CT = [
    ('CT01', 'matched-pair', '92 F.3d 814', "Committee for Idaho's High Desert, Inc. v. Yost", 'k06', '3039',
     'authorizes or directs or in which he participates.', 'the passage the court says Yost actually contains (pair of KB07)'),
    ('CT02', 'matched-pair', '486 U.S. 800', 'Christianson v. Colt Industries Operating Corp.', 'k13', '2183',
     'has the power to revisit prior decisions of its own or of a coordinate court in any circumstance, although as a rule courts should be loathe to do so in the absence of extraordinary circumstances such as where the initial decision was ‘clearly erroneous and would work a manifest injustice.’',
     'the passage the court says Christianson actually contains; Christianson is itself quoting Arizona v. California'),
    ('CT03', 'court-quote', '809 F. Supp. 2d 26', 'W. World Media, LLC v. Ikamobile Ltd.', 'a03', '3180',
     'The first inquiry must be whether [Connecticut’s] long-arm statute authorizes the exercise of jurisdiction under the particular facts of this case. Only if [the court] find[s] the statute to be applicable do[es it] reach the question whether it would offend due process to assert jurisdiction.',
     'page footer "5" and running header removed'),
    ('CT04', 'court-quote', '201 F.3d 110', 'Makarova v. United States', 'a04', '3172', 'when the district court lacks the statutory or constitutional power to adjudicate it.', ''),
    ('CT05', 'court-quote', '354 A.3d 537', 'CVS Pharmacy, Inc. v. City of Philadelphia', 'a05', '3183', 'Preliminary objections in the nature of a demurrer test the legal sufficiency of the complaint.', ''),
    ('CT06', 'court-quote', '550 U.S. 544', 'Bell Atlantic Corp. v. Twombly', 'a06', '3194', 'give the defendant fair notice of what the claim is and the grounds upon which it rests.', ''),
    ('CT07', 'court-quote', '935 So. 2d 393', 'Moss v. Batesville Casket Co.', 'a07', '2707', 'tends to resolve any of the issues properly raised by the parties.', ''),
    ('CT08', 'court-quote', '782 F.2d 829', 'Thompson v. Housing Authority of City of Los Angeles', 'a08', '2452',
     '[i]n the exercise of that power, they may impose sanctions including, where appropriate ... dismissal', 'pleading line number "6" removed; the court closes the quotation after "dismissal"'),
    ('CT09', 'court-quote', '425 F.3d 836', 'Garrett v. Selby Connor Maddux & Janer', 'a09', '2570', 'serv[e] as the litigant’s attorney in constructing arguments and searching the record.', ''),
    ('CT10', 'court-quote', '496 U.S. 384', 'Cooter & Gell v. Hartmarx Corp.', 'k18', '2255',
     'imposes a duty on attorneys to certify that they have conducted a reasonable inquiry and have determined that any papers filed with the court are well grounded in fact, legally tenable, and ‘not interposed for any improper purpose.’',
     'pleading line numbers "22" and "23" removed'),
    ('CT11', 'court-quote', '556 U.S. 662', 'Ashcroft v. Iqbal', 'a11', '2183', 'a complaint must contain sufficient factual matter . . . to ‘state a claim to relief that is plausible on its face.’', ''),
    ('CT12', 'court-quote', '477 U.S. 317', 'Celotex Corp. v. Catrett', 'a12', '2067',
     'if the pleadings, depositions, answers to interrogatories, and admissions on file, together with the affidavits, if any, show that there is no genuine issue as to any material fact and that the moving party is entitled to judgment as a matter of law.',
     'pleading line number "12" removed'),
    ('CT13', 'court-quote', '985 F.3d 1075', 'American Unites for Kids v. Rousseau', 'a13', '1886',
     'Federal courts possess certain ‘inherent powers,’ not conferred by rule or statute, ‘to manage their own affairs so as to achieve the orderly and expeditious disposition of cases.’',
     'pleading line number "27" removed'),
    ('CT14', 'court-quote', '993 F.3d 851', 'Orellana-Recinos v. Garland', 'a14', '1517', '[I]t cannot be incidental, tangential, superficial, or subordinate to another reason for harm.', ''),
    ('CT15', 'court-quote', '562 U.S. 86', 'Harrington v. Richter', 'a15', '1499', 'presumption may be overcome when there is reason to think some other explanation for the state court\'s decision is more likely.', ''),
    ('CT16', 'court-quote', '581 U.S. 101', 'Goodyear Tire & Rubber Co. v. Haeger', 'a16', '1456',
     '[f]ederal courts possess certain ‘inherent powers,’ not conferred by rule or statute, to manage their own affairs so as to achieve the orderly and expeditious disposition of cases.', ''),
    ('CT17', 'court-quote', '368 Ill. App. 3d 1052', 'In re Daphnie E.', 'a17', '1230',
     'is judged by an objective standard based upon the amount of progress measured from the conditions existing at the time custody was taken from the parent.', ''),
    ('CT18', 'court-quote', '18 F. Supp. 3d 309', 'Fedele v. Harris', 'a18', '1148',
     '[T]he Second Circuit has cautioned district courts ‘to take seriously the adjective substantial’ and thus ‘for venue to be proper, significant events or omissions material to the plaintiff’s claim must have occurred in the district in question.’', ''),
    ('CT19', 'court-quote', '684 F.3d 605', 'Keys v. Humana, Inc.', 'a21', '1116', 'construe the complaint in the light most favorable to plaintiff and accept all allegations as true.',
     'first reserve; replaces Peak/Benjamin v. Costco (779 F. Supp. 3d 341, 2025), excluded: no text from CourtListener (citation search empty, name search blocked) or CAP (ends 2019)'),
    ('CT20', 'court-quote', '739 F.3d 689', 'Estes Express Lines v. United States', 'a20', '1016', 'plaintiff bears the burden of establishing subject matter jurisdiction by a preponderance of the evidence.', ''),
]
for (id, sub, cite, name, src, doc, q, notes) in CT:
    items.append(item(id, 'control', sub, cite, name, src, doc, quote=q, notes=notes, expected=CTL))

SUP = 'FAIL or ABSTAIN (never PASS)'
S = [
    ('SP01', '54 A.3d 404', 'Smith v. Township of Richmond', 'k04', '3183', 21, 3, 'The Sunshine Act authorizes penalties against public officials who knowingly participate in illegal meetings.'),
    ('SP02', '486 U.S. 800', 'Christianson v. Colt Industries Operating Corp.', 'k13', '2183', 519, 1, 'should not revisit a jurisdictional ruling made by a coordinate court unless it is clearly erroneous'),
    ('SP03', '421 U.S. 35', 'Withrow v. Larkin', 'k14', '2109', 590, 0, 'would offer a possible temptation to the average man as a judge to forget the burden of proof'),
    ('SP04', '116 F.3d 1432', "Thomas v. Dillard Department Stores, Inc.", 'k15', '2067', 636, 0, '‘Resign or be fired’ scenarios are classic jury questions.'),
    ('SP05', '97 N.Y.2d 436', 'Matter of Sakow', 'k16', '1957', 730, 0, 'A void decree is open to collateral attack at any time.'),
    ('SP06', '286 F.3d 1118', 'Christian v. Mattel, Inc.', 'k17', '1886', 755, 0, 'both baseless and made without a reasonable and competent inquiry'),
    ('SP07', '496 U.S. 384', 'Cooter & Gell v. Hartmarx Corp.', 'k18', '1886', 755, 1, 'a reasonable attorney in like circumstances could believe his actions to be factually and legally justified'),
    ('SP08', '898 F.2d 684', 'Hudson v. Moore Business Forms, Inc.', 'k19', '1886', 755, 3, 'Rule 11 is not intended as a vehicle for intimidation or punishment for minor pleading errors'),
    ('SP09', '496 U.S. 384', 'Cooter & Gell v. Hartmarx Corp.', 'k18', '1886', 755, 4, 'as a bar to the courthouse door'),
    ('SP10', '762 N.W.2d 902', 'People v. Swafford', 'k20', '1924', 778, 0, 'A conviction is not final until the completion of the direct appeal.'),
    ('SP11', '917 N.W.2d 355', 'People v. Kennedy', 'k21', '1924', 778, 1, 'A judgment is not final while an appeal of right remains pending.'),
    ('SP12', '325 Ill. App. 3d 387', 'In re M.A.', 'k23', '1230', 1207, 2, 'rest on a parent\'s personality traits or imperfect cooperation unless those conditions prevent the parent from safely parenting and remain unaddressed despite reasonable opportunity.'),
    ('SP13', '740 F.3d 211', 'Martinez v. Bloomberg LP', 'k24', '1148', 1318, 2, 'assumes the truth of the plaintiff’s factual allegations.'),
    ('SP14', '951 F.2d 504', 'Action S.A. v. Marc Rich & Co.', 'k25', '1111', 1356, 0, '[a] default is willful where the conduct of counsel or the litigant was egregious and was not satisfactorily explained'),
    ('SP15', '137 F.3d 732', 'SEC v. McNulty', 'k26', '1111', 1356, 1, 'waiting to retain counsel does not constitute good cause.'),
    ('SP16', '230 F.R.D. 688', 'Universal City Development Partners, Ltd. v. Ride & Show Engineering', 'k29', '557', 1870, 2, 'is tantamount to no objection at all.'),
    ('SP17', '863 A.2d 772', 'Production Resources Group, L.L.C. v. NCT Group, Inc.', 'k30', '2361', 1984, 2, 'Delaware courts have traditionally construed the scope of permissible discovery liberally.'),
    ('SP18', '34 Cal. 4th 319', 'Sav-On Drug Stores, Inc. v. Superior Court', 'k31', '2362', 2014, 0, 'courts are not obligated to deny certification where the complaint omits facts that would support class treatment.'),
]
for (id, cite, name, src, doc, row, idx, q) in S:
    items.append(item(id, 'supplementary', 'false-quote', cite, name, src, doc, row, idx, quote=q, expected=SUP))

ids = [i['id'] for i in items]
assert len(ids) == len(set(ids))
m = {'name': 'X2 blind verbatim-quote legal test', 'built_utc': '2026-10-03', 'counts': {
    'known-bad': sum(i['set'] == 'known-bad' for i in items), 'control': sum(i['set'] == 'control' for i in items),
    'supplementary': sum(i['set'] == 'supplementary' for i in items)}, 'items': items}
json.dump(m, open(P('items/MANIFEST.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(m['counts'])
