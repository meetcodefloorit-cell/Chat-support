import logging

from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import (
    Conversation,
    ConversationType,
    MemberAssignment,
    MembershipStatus,
    Message,
    MessageType,
    OperatorAssignment,
    Project,
    ProjectUser,
    User,
    UserRole,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seed")


def get_or_create_user(session, *, email: str, name: str, role: UserRole, password: str) -> User:
    email = email.strip()
    user = session.scalar(
        select(User).where(
            User.email == email,
            User.is_active.is_(True),
        )
    )
    if user:
        user.name = name
        user.role = role
        user.is_active = True
        # In development/test deployments we want deterministic credentials after restarts.
        # In production, never overwrite existing passwords via seed.
        if settings.environment.lower() != "production":
            user.password_hash = hash_password(password)
        return user

    user = User(
        email=email,
        name=name,
        role=role,
        password_hash=hash_password(password),
        is_active=True,
    )
    session.add(user)
    session.flush()
    return user


def upsert_project_user(session, project_id: int, user_id: int, role: UserRole) -> None:
    item = session.scalar(
        select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == user_id)
    )
    if item:
        item.role_override = role
        item.status = MembershipStatus.ACTIVE
        return
    session.add(
        ProjectUser(
            project_id=project_id,
            user_id=user_id,
            role_override=role,
            status=MembershipStatus.ACTIVE,
        )
    )


def get_or_create_project(session, name: str, logo_url: str, support_email: str, support_phone: str) -> Project:
    project = session.scalar(select(Project).where(Project.name == name))
    if project:
        project.logo_url = logo_url
        project.support_email = support_email
        project.support_phone = support_phone
        project.is_active = True
        return project
    project = Project(
        name=name,
        logo_url=logo_url,
        support_email=support_email,
        support_phone=support_phone,
        is_active=True,
    )
    session.add(project)
    session.flush()
    return project


def get_or_create_admin_operator_conversation(session, project_id: int, admin_id: int, operator_id: int) -> Conversation:
    conv = session.scalar(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.type == ConversationType.ADMIN_OPERATOR,
            Conversation.admin_id == admin_id,
            Conversation.operator_id == operator_id,
        )
    )
    if conv:
        return conv
    conv = Conversation(
        project_id=project_id,
        type=ConversationType.ADMIN_OPERATOR,
        admin_id=admin_id,
        operator_id=operator_id,
        member_id=None,
        name="",
    )
    session.add(conv)
    session.flush()
    return conv


def get_or_create_operator_member_conversation(session, project_id: int, operator_id: int, member_id: int) -> Conversation:
    conv = session.scalar(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.type == ConversationType.OPERATOR_MEMBER,
            Conversation.operator_id == operator_id,
            Conversation.member_id == member_id,
        )
    )
    if conv:
        return conv
    conv = Conversation(
        project_id=project_id,
        type=ConversationType.OPERATOR_MEMBER,
        operator_id=operator_id,
        member_id=member_id,
        admin_id=None,
        name="",
    )
    session.add(conv)
    session.flush()
    return conv


def add_message_if_empty(session, conversation: Conversation, sender: User, content: str, message_type: MessageType) -> None:
    existing = session.scalar(
        select(Message).where(
            Message.conversation_id == conversation.id,
            Message.sender_user_id == sender.id,
            Message.message_type == message_type,
            Message.content == content,
        )
    )
    if existing:
        return
    session.add(
        Message(
            conversation_id=conversation.id,
            project_id=conversation.project_id,
            sender_user_id=sender.id,
            sender_role=sender.role,
            content=content,
            message_type=message_type,
        )
    )


def main() -> None:
    session = SessionLocal()

    try:
        admin = get_or_create_user(
            session,
            email=settings.super_admin_email,
            name="Super Admin",
            role=UserRole.ADMIN,
            password=settings.super_admin_password,
        )
        session.flush()

        if not settings.seed_demo_projects:
            session.commit()
            logger.info("SEED_DEMO_PROJECTS=false: ensured admin user only.")
            logger.info("Admin login: %s / %s", settings.super_admin_email, settings.super_admin_password)
            return

        # Do not recreate Northwind / BlueCart / etc. after the admin deletes them — only seed
        # demo projects on a completely empty project table (first install).
        project_count = session.scalar(select(func.count()).select_from(Project)) or 0
        if project_count > 0:
            session.commit()
            logger.info(
                "Demo seed skipped: database already has %s project(s). Deleted projects will not reappear.",
                project_count,
            )
            logger.info("Admin login: %s / %s", settings.super_admin_email, settings.super_admin_password)
            return

        operators = [
            get_or_create_user(
                session,
                email=f"operator{i}@example.com",
                name=f"Operator {i}",
                role=UserRole.OPERATOR,
                password="Operator@12345",
            )
            for i in range(1, 6)
        ]

        members = [
            get_or_create_user(
                session,
                email=f"member{i}@example.com",
                name=f"Member {i}",
                role=UserRole.MEMBER,
                password="Member@12345",
            )
            for i in range(1, 41)
        ]

        projects_data = [
            ("Northwind Support", "https://dummyimage.com/160x60/0a7f6f/ffffff&text=Northwind", "help@northwind.example", "+1 555 100 0001"),
            ("BlueCart Help", "https://dummyimage.com/160x60/005f99/ffffff&text=BlueCart", "help@bluecart.example", "+1 555 100 0002"),
            ("Orbit Telecom", "https://dummyimage.com/160x60/cc5500/ffffff&text=Orbit", "help@orbit.example", "+1 555 100 0003"),
            ("Luma Finance", "https://dummyimage.com/160x60/1c3d5a/ffffff&text=Luma", "help@luma.example", "+1 555 100 0004"),
            ("Horizon Med", "https://dummyimage.com/160x60/2f7d32/ffffff&text=Horizon", "help@horizon.example", "+1 555 100 0005"),
        ]

        projects = [
            get_or_create_project(session, name=name, logo_url=logo, support_email=email, support_phone=phone)
            for name, logo, email, phone in projects_data
        ]

        session.flush()

        member_pointer = 0
        for project in projects:
            upsert_project_user(session, project.id, admin.id, UserRole.ADMIN)

            for operator in operators:
                upsert_project_user(session, project.id, operator.id, UserRole.OPERATOR)

                op_assignment = session.scalar(
                    select(OperatorAssignment).where(
                        OperatorAssignment.project_id == project.id,
                        OperatorAssignment.operator_id == operator.id,
                    )
                )
                if op_assignment:
                    op_assignment.admin_id = admin.id
                    op_assignment.is_active = True
                else:
                    session.add(
                        OperatorAssignment(
                            project_id=project.id,
                            admin_id=admin.id,
                            operator_id=operator.id,
                            is_active=True,
                        )
                    )

                admin_operator_conv = get_or_create_admin_operator_conversation(
                    session,
                    project_id=project.id,
                    admin_id=admin.id,
                    operator_id=operator.id,
                )
                add_message_if_empty(
                    session,
                    admin_operator_conv,
                    admin,
                    f"Welcome {operator.name}, you are assigned to {project.name}.",
                    MessageType.TEXT,
                )

                for _ in range(4):
                    member = members[member_pointer % len(members)]
                    member_pointer += 1

                    upsert_project_user(session, project.id, member.id, UserRole.MEMBER)

                    member_assignment = session.scalar(
                        select(MemberAssignment).where(
                            MemberAssignment.project_id == project.id,
                            MemberAssignment.member_id == member.id,
                        )
                    )
                    if member_assignment:
                        member_assignment.operator_id = operator.id
                        member_assignment.is_active = True
                    else:
                        session.add(
                            MemberAssignment(
                                project_id=project.id,
                                operator_id=operator.id,
                                member_id=member.id,
                                is_active=True,
                            )
                        )

                    conv = get_or_create_operator_member_conversation(
                        session,
                        project_id=project.id,
                        operator_id=operator.id,
                        member_id=member.id,
                    )
                    add_message_if_empty(
                        session,
                        conv,
                        operator,
                        f"Hello {member.name}, this is {operator.name} from {project.name} support.",
                        MessageType.TEXT,
                    )
                    add_message_if_empty(
                        session,
                        conv,
                        admin,
                        "Please note: service windows are 9 AM to 6 PM.",
                        MessageType.ADMIN_BROADCAST,
                    )

        session.commit()
        logger.info("Seed completed successfully")
        logger.info("Admin login: %s / %s", settings.super_admin_email, settings.super_admin_password)
        logger.info("Operator login example: operator1@example.com / Operator@12345")
        logger.info("Member login example: member1@example.com / Member@12345")
    finally:
        session.close()


if __name__ == "__main__":
    main()
