from enum import Enum


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    OPERATOR = "OPERATOR"
    MEMBER = "MEMBER"


class MembershipStatus(str, Enum):
    ACTIVE = "active"
    REMOVED = "removed"
    TERMINATED = "terminated"


class ConversationType(str, Enum):
    ADMIN_OPERATOR = "admin_operator"
    OPERATOR_MEMBER = "operator_member"
    GROUP = "group"


class MessageType(str, Enum):
    TEXT = "text"
    ADMIN_BROADCAST = "admin_broadcast"


class ChatSessionStatus(str, Enum):
    """
    One ChatSession = one bounded customer<->operator interaction inside a (permanent)
    operator_member Conversation thread. A session opens on the first customer message
    since the previous session ended (or on the conversation's first-ever customer
    message), and is server-closed within CHAT_MAX_DURATION_SECONDS.
    """

    ACTIVE = "active"
    COMPLETED = "completed"  # operator manually closed with a valid thank-you, before the deadline
    AUTO_CLOSED = "auto_closed"  # reached the 3-minute maximum duration
    ABANDONED = "abandoned"  # member disconnected before the operator completed the session


class OperatorMistakeType(str, Enum):
    FIRST_RESPONSE_SLA_BREACH = "first_response_sla_breach"
    MISSING_THANK_YOU = "missing_thank_you"


class PresenceEventType(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"


class ChatSessionEventType(str, Enum):
    SESSION_STARTED = "session_started"
    OPERATOR_FIRST_RESPONSE = "operator_first_response"
    FIRST_RESPONSE_SLA_MET = "first_response_sla_met"
    FIRST_RESPONSE_SLA_BREACHED = "first_response_sla_breached"
    CUSTOMER_ABANDONED = "customer_abandoned"
    CLOSE_ATTEMPT_BLOCKED = "close_attempt_blocked"
    THANK_YOU_VALIDATED = "thank_you_validated"
    THANK_YOU_MISSING = "thank_you_missing"
    CHAT_AUTO_CLOSED = "chat_auto_closed"
    CHAT_COMPLETED = "chat_completed"
