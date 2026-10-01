-- Attendance gains an L (leave) mark; trainings can target a department.
ALTER TABLE attendance DROP CONSTRAINT attendance_mark_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_mark_check
  CHECK (mark IN ('P','A','H','L'));

ALTER TABLE trainings ADD COLUMN department TEXT;
