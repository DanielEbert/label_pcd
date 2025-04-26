from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import os
import pypcd4

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.get("/pcd")
def pcd():
    pcd_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'merged_0.pcd')
    pc = pypcd4.PointCloud.from_path(pcd_path).numpy()
    xyz = [[float(i) for i in row] for row in pc[:, :3]]

    return xyz
