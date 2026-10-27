"""Mechanical control extraction (pre-run): per decision, quotations of >=10 words that the court attributes to a
reported case (a reporter citation within 220 chars after the closing quote, no ECF/Doc./Dkt. pointer in between)."""
import glob, re, json
CITE = re.compile(r"(\d{1,4}) (U\.S\.|S\. ?Ct\.|F\.[234]d|F\. ?Supp\. ?[23]d|F\. ?Supp\.|F\. ?App'x|F\.4th|So\. ?[23]d|N\.E\.[23]d|N\.W\.[23]d|S\.E\.[23]d|S\.W\.[23]d|P\.[23]d|A\.[23]d|Cal\. ?App\. ?[2345](?:d|th)|Cal\. ?[2345](?:d|th)|Ill\. ?App\. ?3d|Ill\. ?2d|N\.Y\.[23]d|Conn\.|Mich\.|Wash\. ?2d|F\.R\.D\.|B\.R\.) (\d{1,5})")
Q = re.compile(r'[“"]([^”"]{50,700})[”"]')
out = []
for f in sorted(glob.glob('sources/charlotin/decisions/*.txt')):
    t = re.sub(r'\s+', ' ', open(f, encoding='utf-8').read())
    n = 0
    for m in Q.finditer(t):
        q = m.group(1)
        if len(q.split()) < 10: continue
        after = t[m.end():m.end() + 220]
        c = CITE.search(after)
        if not c: continue
        between = after[:c.start()]
        if re.search(r'\b(ECF|Doc\.|Dkt\.|D\.E\.|DE \d|Pl\.\'s|Aplt\.|Docket)', between): continue
        # the reporter cite must be the FIRST citation after the quote: no short form, statute, rule, signal or new quote in between
        if re.search(r'(\bId\.|\bid\.|\bat \d|§|U\.S\.C|Fed\. ?R\.|quoting|citing|Ibid|supra|[“"])', between): continue
        if len(between) > 140: continue
        # a ')' or ';' before the cite means the quote sat in a parenthetical of an EARLIER citation; a WL/LEXIS/docket
        # number means the first citation is unreported (no reporter text to check against)
        if re.search(r'[);]|\bWL\b|LEXIS|\bNo\.', between): continue
        # a citation signal (See, Cf., accord, But) means the cited case SUPPORTS the quote rather than being its source
        if re.search(r'\b(?:See|see|Cf\.|cf\.|accord|But)\b', between): continue
        # the court reproducing a FILING's quotation (the known-bad pool), not quoting authority itself
        before = t[max(0, m.start() - 90):m.start()]
        if re.search(r'attribut|purport|Plaintiffs? (?:cites?|quotes?|claims?|argues?)|(?:he|she|they) quote|brief|for the proposition', before, re.I): continue
        out.append({'decision': __import__('os').path.basename(f), 'quote_raw': q, 'cite': ' '.join(c.groups()), 'after': after[:c.end()]})
        n += 1
        if n >= 3: break
json.dump(out, open('items/controls-raw.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
for o in out: print(o['decision'][:28], '|', o['cite'], '|', o['quote_raw'][:110], '| AFTER:', o['after'][:90])
