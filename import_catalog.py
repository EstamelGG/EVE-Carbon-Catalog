from pathlib import Path
import json,sys
def collect(root):
    categories=[]
    for cat in json.loads((root/'data/catalog-index.json').read_bytes())['categories']:
        groups=[]
        for group in cat['groups']:
            items=json.loads((root/group['itemsURL']).read_bytes())['items']
            groups.append(dict(id=group['id'],name=group['name'],items=[
                {k:item.get(k) for k in ('id','name')} for item in items]))
        categories.append(dict(id=cat['id'],name=cat['name'],groups=groups))
    return categories
if __name__=='__main__':
    (Path(__file__).parent/'public/catalog.json').write_text(json.dumps(collect(Path(sys.argv[1])),ensure_ascii=False,separators=(',',':')),encoding='utf8')
