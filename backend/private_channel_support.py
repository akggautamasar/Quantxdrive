"""Extra peer resolution for the new Channels feature."""

from fastapi import HTTPException


def _is_private_invite(target):
    value = str(target or "").strip().lower()
    return value.startswith("+") or "t.me/+" in value or "t.me/joinchat/" in value or "telegram.me/+" in value or "telegram.me/joinchat/" in value


def _invite_url(target):
    value = str(target or "").strip()
    if value.startswith("+"): return "https://t.me/" + value
    if value.startswith(("t.me/", "telegram.me/")): return "https://" + value
    return value


async def _session_identity(session):
    try:
        me = await session.get_me()
        if not me:
            return "unknown Telegram account"
        username = f"@{me.username}" if getattr(me, "username", None) else "no username"
        name = " ".join(x for x in [getattr(me, "first_name", None), getattr(me, "last_name", None)] if x)
        return f"{name or 'Telegram user'} ({username}, id {me.id})"
    except Exception as exc:
        return f"unable to read Telegram account ({type(exc).__name__}: {exc})"


def install():
    import channels_service as cs
    import main
    if getattr(cs, "_private_channel_support_installed", False): return
    original = cs._resolve_with_clients

    async def resolve(target):
        session = main.pyro_client
        if not session: raise HTTPException(status_code=503, detail="Telegram session is not ready")

        if _is_private_invite(target):
            invite = _invite_url(target)
            errors = []
            try:
                chat = await session.get_chat(invite)
                if getattr(chat, "id", None) is not None: return chat, session, "session"
            except Exception as exc: errors.append(f"lookup: {exc}")
            try:
                chat = await session.join_chat(invite)
                if getattr(chat, "id", None) is not None: return chat, session, "session"
            except Exception as exc:
                upper = str(exc).upper()
                if "INVITE_REQUEST_SENT" in upper:
                    raise HTTPException(status_code=409, detail="Telegram join request was sent. Approve the SESSION_STRING account in Telegram, then add the channel again.")
                if "ALREADY_PARTICIPANT" in upper:
                    try:
                        chat = await session.get_chat(invite)
                        if getattr(chat, "id", None) is not None: return chat, session, "session"
                    except Exception as lookup_exc: errors.append(f"already-member lookup: {lookup_exc}")
                else: errors.append(f"join: {exc}")
            identity = await _session_identity(session)
            raise HTTPException(status_code=400, detail="Telegram could not resolve this private invite. Make sure the SESSION_STRING account has access and the invite is valid. Connected SESSION_STRING account: " + identity + (". " + " | ".join(errors) if errors else ""))

        if isinstance(target, int):
            try:
                chat = await session.get_chat(target)
                if getattr(chat, "id", None) is not None: return chat, session, "session"
            except Exception as exc:
                print(f"📺 Numeric ID lookup needs peer refresh: {exc}", flush=True)
            try:
                async for dialog in session.get_dialogs():
                    chat = getattr(dialog, "chat", None)
                    if chat is not None and int(chat.id) == int(target):
                        print(f"📺 Resolved {target} from SESSION_STRING dialogs", flush=True)
                        return chat, session, "session"
            except Exception as exc:
                print(f"⚠️ SESSION_STRING dialog refresh failed: {exc}", flush=True)
            try:
                chat = await session.get_chat(target)
                if getattr(chat, "id", None) is not None: return chat, session, "session"
            except Exception as exc:
                print(f"📺 SESSION_STRING numeric retry failed: {exc}", flush=True)

            identity = await _session_identity(session)
            # Keep the original resolver as a fallback so a configured bot can
            # still access a channel when the user session cannot resolve it.
            try:
                return await original(target)
            except HTTPException as original_error:
                raise HTTPException(status_code=original_error.status_code, detail=f"Could not resolve channel ID {target}. Connected SESSION_STRING account: {identity}. This account must see/be a member of the channel. Telegram: {original_error.detail}")

        return await original(target)

    cs._resolve_with_clients = resolve
    cs._private_channel_support_installed = True
