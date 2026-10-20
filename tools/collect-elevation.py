import base64
import datetime
import json
import math
import time
import urllib.parse
import urllib.request
import zlib

west, east, south, north = 106.477, 106.587, 29.530, 29.573
step = 1 / 1200
columns = math.ceil((east - west) / step) + 1
rows = math.ceil((north - south) / step) + 1
coordinates = [(south + row * step, west + column * step)
    for row in range(rows) for column in range(columns)]
elevations = []
for start in range(0, len(coordinates), 100):
    batch = coordinates[start:start + 100]
    query = urllib.parse.urlencode({'locations': '|'.join(f'{lat:.7f},{lon:.7f}' for lat,lon in batch), 'interpolation':'bilinear'})
    request = urllib.request.Request('https://api.opentopodata.org/v1/srtm30m?' + query,
        headers={'User-Agent':'Yuzhong3DResearch/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get('status') != 'OK' or len(result.get('results', [])) != len(batch):
        raise RuntimeError('Incomplete elevation source response: ' + str(result.get('error')))
    values = [point['elevation'] for point in result['results']]
    if any(value is None or not math.isfinite(value) for value in values):
        raise RuntimeError('Missing SRTM elevation inside the peninsula coverage')
    elevations.extend(values)
    if start % 1000 == 0:
        print('PROGRESS:' + str(len(elevations)) + '/' + str(len(coordinates)), flush=True)
    time.sleep(1.05)

data = {'west':west,'south':south,'stepLongitude':step,'stepLatitude':step,
    'columns':columns,'rows':rows,'elevations':elevations,
    'source':'https://www.opentopodata.org/datasets/srtm/',
    'dataset':'SRTM GL1 30m','sampleSpacingMeters':{'eastWest':80.7,'northSouth':92.8},
    'units':'metres','horizontalDatum':'WGS84','verticalDatum':'EGM96',
    'acquired':'2000-02','retrieved':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'limitations':'Satellite surface elevations include urban/vegetation bias. This regular grid is downsampled from 30m data and is not a contemporary ground survey.'}
payload = base64.b64encode(zlib.compress(json.dumps(data,separators=(',',':')).encode())).decode()
print('SUMMARY:' + json.dumps({'samples':len(elevations),'columns':columns,'rows':rows,
    'minimum':min(elevations),'maximum':max(elevations),'payloadCharacters':len(payload)}))
print('DATA:'+payload)
