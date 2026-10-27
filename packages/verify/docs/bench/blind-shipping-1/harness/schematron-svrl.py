"""blind-shipping-1, e-invoice arm (PREREG.md section 4.2): run official schematron validators and write their SVRL.

    python harness/schematron-svrl.py <job.json>

The job names the validators and the files. A validator is either a compiled XSLT the source repository ships
("xslt"), or a schematron (".sch") compiled here first with the SchXslt pipeline the job names ("sch" and "schxslt").
Every file is transformed by every validator; the SVRL goes to <out>/<validator id>/<key>.svrl.xml. A transformation
that fails is recorded with its message and no SVRL is written for it (the file is then left unlabelled for that
validator, section 10). Nothing is retried, repaired or skipped silently.

Needs SaxonC-HE for Python (XSLT 3.0; the schematrons are XSLT 2.0):  python -m pip install "saxonche>=12.5,<13"
"""
import hashlib
import json
import os
import sys


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def main():
    if len(sys.argv) != 2:
        print('usage: schematron-svrl.py <job.json>', file=sys.stderr)
        return 3
    job = json.load(open(sys.argv[1], encoding='utf-8'))
    try:
        from saxonche import PySaxonProcessor
    except ImportError:
        print('SaxonC-HE for Python is not installed. Install it with:  python -m pip install "saxonche>=12.5,<13"', file=sys.stderr)
        return 4
    out = job['out']
    os.makedirs(out, exist_ok=True)
    result = {'saxon': None, 'python': sys.version.split()[0], 'validators': {}, 'results': []}
    with PySaxonProcessor(license=False) as proc:
        result['saxon'] = proc.version
        xp = proc.new_xslt30_processor()
        for v in job['validators']:
            vid = v['id']
            meta = {}
            if v.get('xslt'):
                stylesheet = v['xslt']
                meta['compiled_from'] = 'the repository\'s own compiled XSLT'
            else:
                pipeline = xp.compile_stylesheet(stylesheet_file=v['schxslt'])
                compiled = pipeline.transform_to_string(source_file=v['sch'])
                if not compiled:
                    raise RuntimeError(f'{vid}: SchXslt produced no XSLT from {v["sch"]}')
                stylesheet = os.path.join(out, f'{vid}.compiled.xsl')
                with open(stylesheet, 'w', encoding='utf-8', newline='\n') as f:
                    f.write(compiled)
                meta['compiled_from'] = 'the repository\'s schematron, compiled with SchXslt'
                meta['schxslt_pipeline_sha256'] = sha256_file(v['schxslt'])
                meta['compiled_sha256'] = sha256_file(stylesheet)
            meta['stylesheet_sha256'] = sha256_file(stylesheet)
            executable = xp.compile_stylesheet(stylesheet_file=stylesheet)
            os.makedirs(os.path.join(out, vid), exist_ok=True)
            for item in job['inputs']:
                entry = {'validator': vid, 'key': item['key'], 'ok': False}
                try:
                    svrl = executable.transform_to_string(source_file=item['file'])
                    if not svrl:
                        raise RuntimeError('the transformation returned nothing')
                    path = os.path.join(out, vid, item['key'] + '.svrl.xml')
                    with open(path, 'w', encoding='utf-8', newline='\n') as f:
                        f.write(svrl)
                    entry['ok'] = True
                    entry['svrl_sha256'] = sha256_file(path)
                except Exception as e:  # recorded, never hidden: the file stays unlabelled for this validator
                    entry['error'] = f'{type(e).__name__}: {e}'
                result['results'].append(entry)
            result['validators'][vid] = meta
    with open(os.path.join(out, 'job-result.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(result, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
