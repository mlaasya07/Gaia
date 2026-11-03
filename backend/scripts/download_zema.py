"""Download and extract the public ZeMA hydraulic dataset from Zenodo."""
from pathlib import Path
import requests, zipfile, io, sys

URLS = [
    "https://zenodo.org/records/1323611/files/data.zip?download=1",
    "https://zenodo.org/record/1323611/files/data.zip?download=1",
    "https://archive.ics.uci.edu/ml/machine-learning-databases/00447/data.zip",
]
DEST = Path("data/raw/zema")
DEST.mkdir(parents=True, exist_ok=True)

for url in URLS:
    try:
        print(f"Downloading {url}")
        with requests.get(url, stream=True, timeout=90, headers={"User-Agent": "GaiaStudentResearch/1.0"}) as r:
            r.raise_for_status()
            content = io.BytesIO()
            for chunk in r.iter_content(chunk_size=1024*1024):
                if chunk:
                    content.write(chunk)
        content.seek(0)
        if not zipfile.is_zipfile(content):
            raise RuntimeError("Response was not a ZIP archive; the host may be rate-limiting the request.")
        with zipfile.ZipFile(content) as zf:
            zf.extractall(DEST)
        print(f"Extracted {len(list(DEST.rglob('*')))} paths under {DEST.resolve()}")
        print("Check that profile.txt and sensor .txt files exist before training.")
        sys.exit(0)
    except Exception as exc:
        print(f"Download attempt failed: {exc}")
print("\nAutomatic download failed. Open https://zenodo.org/records/1323611, download data.zip,")
print(f"and extract it into: {DEST.resolve()}")
sys.exit(1)
