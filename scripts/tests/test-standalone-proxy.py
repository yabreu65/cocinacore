#!/usr/bin/env python3
# Read-only HTTP/metadata probe for the dedicated disposable F5.5 stack.
import os
if os.environ.get('CC_STANDALONE_DISPOSABLE_TEST') != 'true':
    raise SystemExit('Explicit disposable test flag required')
import http.client,json,subprocess,re
from urllib.request import urlopen,Request
from urllib.error import HTTPError
base='http://127.0.0.1:4330'
def call(path,method='GET',body=None,headers=None):
    try:r=urlopen(Request(base+path,data=body,headers=headers or {},method=method),timeout=10)
    except HTTPError as e:r=e
    with r:return r.status,dict(r.headers),r.read()
for path in ['/','/login','/signup']:
    code,h,b=call(path);assert code==200,(path,code);assert h.get('X-Content-Type-Options')=='nosniff';assert h.get('X-Frame-Options')=='DENY';print(path,'HTTP',code)
    if path=='/':
        css=re.findall(r'href="([^" ]+\.css[^" ]*)"',b.decode());assert css
        for uri in css:assert call(uri.replace('&amp;','&'))[0]==200
        print('CSS_ASSETS_PASS',len(css))
code,h,b=call('/api/health');d=json.loads(b);assert code==200 and all(d['dependencies'][x]['status']=='ok' for x in ['database','redis','storage']);print('ALL_DEPENDENCIES_HEALTHY',d['dependencies'])
assert call('/api/meal-plan/coverage?horizonDays=7')[0]==401;print('ANONYMOUS_PRIVATE_API_DENIED')
# Send only headers with an oversized length; nginx must reject before body transfer.
for path,size in [('/api/health',2*1024*1024+1),('/api/owner/global-pdfs',50*1024*1024+1)]:
    conn=http.client.HTTPConnection('127.0.0.1',4330,timeout=10)
    conn.putrequest('POST',path);conn.putheader('Content-Length',str(size));conn.putheader('Content-Type','application/octet-stream');conn.endheaders();r=conn.getresponse();assert r.status==413,(path,r.status);r.read();conn.close();print('OVERSIZE_REJECTED',path,413)
assert call('/api/owner/global-pdfs','POST',b'',{'Content-Type':'application/octet-stream'})[0]==401;print('OWNER_UPLOAD_ANONYMOUS_DENIED')
for service in ['app','postgres','redis','storage','nginx']:
    d=json.loads(subprocess.check_output(['docker','inspect','cocinacore-f55-test-'+service+'-1']))[0];ports=d['HostConfig']['PortBindings'] or {};nets=set(d['NetworkSettings']['Networks']);assert d['State']['Health']['Status']=='healthy';assert d['HostConfig']['LogConfig']['Config']=={'max-file':'3','max-size':'10m'}
    if service=='nginx':assert ports=={'8080/tcp':[{'HostIp':'127.0.0.1','HostPort':'4330'}]};assert nets=={'cocinacore-f55-test_edge'}
    elif service=='app':assert not ports and nets=={'cocinacore-f55-test_edge','cocinacore-f55-test_data'}
    else:assert not ports and nets=={'cocinacore-f55-test_data'}
    print('NETWORK_LOGS_HEALTH_PASS',service)
assert json.loads(subprocess.check_output(['docker','network','inspect','cocinacore-f55-test_data']))[0]['Internal']
print('PRIVATE_NETWORK_PASS')
