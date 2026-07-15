"""
auth.py

Google OAuth (authorization-code flow via authlib) + session-based access
control. The browser never talks to Google's SDK directly -- /auth/login
redirects to Google, /auth/callback verifies the ID token and, if the
email is on the app_users allowlist, sets a signed httponly session cookie
(via Starlette's SessionMiddleware, added in api.py) and sends the browser
back to the frontend.

require_user/require_admin are dependency *factories* (not FastAPI
dependencies themselves) so api.py can build them once, closing over the
single shared engine, rather than each request opening a second connection
pool the way a module-level get_engine() call here would.
"""

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import RedirectResponse

import app_users


def make_require_user(engine):
    def require_user(request: Request) -> dict:
        email = request.session.get("email")
        if not email:
            raise HTTPException(status_code=401, detail="Not authenticated")
        user = app_users.get_user(engine, email)
        if user is None:
            # Allowlist entry was removed after the cookie was issued --
            # re-checking on every request (not just trusting the cookie)
            # is what makes admin removal take effect immediately.
            request.session.clear()
            raise HTTPException(status_code=401, detail="Not authenticated")
        return user

    return require_user


def make_require_admin(engine):
    require_user = make_require_user(engine)

    def require_admin(user: dict = Depends(require_user)) -> dict:
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        return user

    return require_admin


def build_auth_router(engine, google_client_id: str, google_client_secret: str, backend_url: str, frontend_url: str) -> APIRouter:
    oauth = OAuth()
    oauth.register(
        name="google",
        client_id=google_client_id,
        client_secret=google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

    require_user = make_require_user(engine)
    router = APIRouter(prefix="/auth", tags=["auth"])

    @router.get("/login")
    async def login(request: Request):
        # redirect_uri is built from an explicit backend_url, not
        # request.url_for(...) -- Render terminates TLS and forwards plain
        # HTTP internally, so scheme auto-detection would produce an
        # http:// URL that doesn't match the https:// URI registered with
        # Google, and the callback would fail with redirect_uri_mismatch.
        redirect_uri = f"{backend_url}/auth/callback"
        return await oauth.google.authorize_redirect(request, redirect_uri)

    @router.get("/callback")
    async def callback(request: Request):
        token = await oauth.google.authorize_access_token(request)
        userinfo = token.get("userinfo")
        if userinfo is None or not userinfo.get("email"):
            return RedirectResponse(f"{frontend_url}/?denied=1")

        email = userinfo["email"].strip().lower()
        user = app_users.get_user(engine, email)
        if user is None:
            # Not on the allowlist -- no session cookie is set.
            return RedirectResponse(f"{frontend_url}/?denied=1")

        request.session["email"] = email
        return RedirectResponse(frontend_url)

    @router.get("/logout")
    async def logout(request: Request):
        request.session.clear()
        return RedirectResponse(frontend_url)

    @router.get("/me")
    async def me(user: dict = Depends(require_user)):
        return {"email": user["email"], "role": user["role"]}

    return router
