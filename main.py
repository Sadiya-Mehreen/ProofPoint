from dotenv import load_dotenv
from fastapi import FastAPI

from api.routes import router

load_dotenv()

app = FastAPI()
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
