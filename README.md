# Solana Attendance Deposit

This is a Solana program that allows users to deposit funds into a program account and then withdraw them after a certain amount of time has passed. The program is designed to be used as a way to incentivize attendance at events, such as courses, hackathons or meetups.

## Interaction Flow

1. Course Manager ➡️ Create courses ➡️ Specify required deposit and number of lessons in course
2. Students ➡️ Register courses ➡️ Deposit Funds (SPL tokens)
3. Course Manager ➡️ Create lessons and set a deadline for checking in attendance
4. Students check in their attendance for every lesson before their deadline
5. After the deadline, students cannot check in their attendance for that particular lesson
6. When the number of lessons created equals the number of lessons specified when creating the course, the course is considered completed.
7. Students can withdraw their deposit after the course is completed if all of their attendances are checked.

## Pre-requisites

- solana-cargo-build-sbf 1.18.9
- solana-cli 1.18.9
- platform-tools v1.41
- rustc 1.75.0
- anchor-cli 0.29.0
- node v20.11.1
- yarn 1.22.22
