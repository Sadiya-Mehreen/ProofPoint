from dotenv import load_dotenv
from fastapi import FastAPI
import crewai.llms.cache as _crewai_cache

_crewai_cache.mark_cache_breakpoint = lambda msg: msg
from api.routes import router

load_dotenv()

app = FastAPI()
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
