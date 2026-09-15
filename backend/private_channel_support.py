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
            raise HTTPException(status_code=400, detail="Telegram could not resolve this private invite. Make sure the SESSION_STRING account has access and the invite is valid. " + " | ".join(errors))

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

            # Do not stop at the user session: if BOT_TOKEN is configured and the
            # bot is a member/admin, the original resolver can resolve the numeric
            # ID through that second Telegram identity.
            return await original(target)

        return await original(target)

    cs._resolve_with_clients = resolve
    cs._private_channel_support_installed = True
