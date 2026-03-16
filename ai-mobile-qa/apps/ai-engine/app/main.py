import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import router as v1_router


def _load_local_dotenv() -> None:
	"""Best-effort load of apps/ai-engine/.env for local dev.

	Does not override existing environment variables.
	"""
	try:
		from dotenv import load_dotenv
	except Exception:
		return

	base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
	dotenv_path = os.path.join(base_dir, ".env")
	if os.path.exists(dotenv_path):
		load_dotenv(dotenv_path=dotenv_path, override=False)


def create_app() -> FastAPI:
	_load_local_dotenv()

	app = FastAPI(title="Tezzy AI Engine", version="0.1.0")

	# Optional CORS for local dev UI clients (e.g., Tauri/Vite).
	# - Set TEZZY_DEV_CORS=1 to allow any origin (local-only dev).
	# - Or set TEZZY_CORS_ORIGINS to a comma-separated allowlist.
	dev_cors = os.getenv("TEZZY_DEV_CORS", "").strip()
	origins_env = os.getenv("TEZZY_CORS_ORIGINS", "").strip()
	if dev_cors == "1":
		app.add_middleware(
			CORSMiddleware,
			allow_origins=["*"],
			allow_methods=["*"],
			allow_headers=["*"],
		)
	elif origins_env:
		origins = [o.strip() for o in origins_env.split(",") if o.strip()]
		if origins:
			app.add_middleware(
				CORSMiddleware,
				allow_origins=origins,
				allow_credentials=True,
				allow_methods=["*"],
				allow_headers=["*"],
			)

	app.include_router(v1_router, prefix="/v1")
	return app


app = create_app()


if __name__ == "__main__":
	# Convenience local dev entrypoint.
	# Prefer: uvicorn app.main:app --reload --port 8010
	import uvicorn

	uvicorn.run(
		"app.main:app",
		host=os.getenv("HOST", "127.0.0.1"),
		port=int(os.getenv("PORT", "8010")),
		reload=bool(os.getenv("RELOAD", "")),
	)
