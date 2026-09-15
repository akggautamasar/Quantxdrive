"""Robust private-channel invite resolution for the Channels feature.

Invite links are user-authenticated Telegram operations.  Keep them on the
SESSION_STRING client instead of falling through to the optional bot client.
"""

from fastapi import HTTPException


def _is_private_invite(target):
    value = str(target or "").strip().lower()
    return (
        value.startswith("+")
        or "t.me/+" in value
        or "t.me/joinchat/" in value
        or "telegram.me/+" in value
        or "telegram.me/joinchat/" in value
    )


def _invite_url(target):
    value = str(target or "").strip()
    if value.startswith("+"):
        return "https://t.me/" + value
    if value.startswith(("t.me/", "telegram.me/")):
        return "https://" + value
    return value


def install():
    """Wrap channels_service's resolver with reliable invite-link handling."""
    import channels_service as cs
    import main

    if getattr(cs, "_private_invite_support_installed", False):
        return

    original = cs._resolve_with_clients

    async def resolve(target):
        if not _is_private_invite(target):
            return await original(target)

        client = main.pyro_client
        if not client:
            raise HTTPException(status_code=503, detail="Telegram session is not ready")

        invite = _invite_url(target)
        errors = []

        # If the session account is already a member, get_chat resolves the
        # invite and returns a real Chat. A ChatPreview has no chat id, so never
        # let it continue into add_channel as if it were a normal Chat.
        try:
            chat = await client.get_chat(invite)
            if getattr(chat, "id", None) is not None:
                print(f"📺 Private invite already resolves to chat {chat.id}", flush=True)
                return chat, client, "session"
        except Exception as exc:
            errors.append(f"session lookup: {type(exc).__name__}: {exc}")

        # If the account is not yet a member, Pyrogram joins the private
        # channel using messages.importChatInvite under the hood.
        try:
            chat = await client.join_chat(invite)
            if getattr(chat, "id", None) is not None:
                print(f"📺 Joined private invite channel {chat.id}", flush=True)
                return chat, client, "session"
            errors.append("join returned no chat id")
        except Exception as exc:
            text = str(exc)
            upper = text.upper()
            if "USER_ALREADY_PARTICIPANT" in upper or "ALREADY_PARTICIPANT" in upper:
                try:
                    chat = await client.get_chat(invite)
                    if getattr(chat, "id", None) is not None:
                        return chat, client, "session"
                except Exception as lookup_exc:
                    errors.append(f"already-member lookup: {lookup_exc}")
            elif "INVITE_REQUEST_SENT" in upper:
                raise HTTPException(
                    status_code=409,
                    detail="Telegram join request was sent. Approve the SESSION_STRING account in Telegram, then add the channel again.",
                )
            else:
                errors.append(f"session join: {type(exc).__name__}: {exc}")

        raise HTTPException(
            status_code=400,
            detail=(
                "Telegram could not resolve this private invite. Make sure the "
                "SESSION_STRING account has access to the channel and the invite "
                "is valid. " + " | ".join(errors)
            ),
        )

    cs._resolve_with_clients = resolve
    cs._private_invite_support_installed = True
