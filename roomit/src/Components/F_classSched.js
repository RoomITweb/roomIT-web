import React, { useState, useEffect } from 'react';
import { getDatabase, ref, get, set, query, orderByChild, equalTo } from 'firebase/database';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { app } from './firebase';
import ReactModal from 'react-modal';
import BarcodeScanner from './BarcodeScanner';


function FacultySchedule() {
  const [facultyName, setFacultyName] = useState('');
  const [facultySchedules, setFacultySchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [attendingClass, setAttendingClass] = useState(false);
  const [roomOccupied, setRoomOccupied] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedSchoolYear, setSelectedSchoolYear] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const auth = getAuth(app);
  const database = getDatabase(app);
  ReactModal.setAppElement('#root'); // or any other root element in your HTML

  navigator.mediaDevices.getUserMedia({ video: true })
  .then(function (stream) {
    // Success - the camera is accessible
  })
  .catch(function (error) {
    console.error('Error accessing camera:', error);
  });


  useEffect(() => {
    const fetchData = async (user) => {
      try {
        const userRef = ref(database, `users/${user.uid}`);
        const userSnapshot = await get(userRef);
  
        if (userSnapshot.exists()) {
          const userData = userSnapshot.val();
          if (userData.role === 'faculty') {
            setFacultyName(`${userData.firstName} ${userData.lastName}`);
          }
        }
  
        if (selectedSchoolYear && selectedSemester) {
          const schedulesRef = ref(database, 'schedules');
          const facultyScheduleQuery = query(
            schedulesRef,
            orderByChild('facultyName'),
            equalTo(facultyName)
          );
          const scheduleSnapshot = await get(facultyScheduleQuery);
  
          if (scheduleSnapshot.exists()) {
            const facultySchedules = [];
            scheduleSnapshot.forEach((schedule) => {
              const scheduleData = schedule.val();
              if (
                scheduleData.schoolYear === selectedSchoolYear &&
                scheduleData.semester === selectedSemester
              ) {
                facultySchedules.push(scheduleData);
              }
            });
            setFacultySchedules(facultySchedules);
          }
        }
      } catch (error) {
        console.error('Error fetching faculty data:', error);
      } finally {
        setLoading(false);
      }
    };
  
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        fetchData(user);
      } else {
        setLoading(false);
      }
    });
  
    return () => {
      unsubscribe();
    };
  }, [auth, database, facultyName, selectedSchoolYear, selectedSemester]);

  const handleOpenScanner = (subject) => {
    setSelectedSchedule(subject);
    setShowScanner(true);
    setIsScannerOpen(true);

    if (subject.room) {
      setIsScannerOpen(true);
      setScanMessage(`Room: ${subject.room}`);
    }
  };

  const handleQrCodeScan = (result) => {
    // Handle the QR code scan result here
    console.log('QR Code Scan Result:', result);
    setScanResult(result);

    if (scanMessage && result.includes(scanMessage)) {
      setAttendingClass(true);
      setErrorMessage('');
    } else {
      setErrorMessage('Error: Room not found or invalid QR code.');
    }
    
  };

  const handleCloseScanner = () => {
    setShowScanner(false);
    setScanResult(null);
    setAttendingClass(false);
    setScanMessage('');
    setErrorMessage('');
  };

  const handleAttendClass = async () => {
    if (auth.currentUser) {
      const userUid = auth.currentUser.uid;
  
      const occupiedRoomRef = ref(database, `users/${userUid}/occupiedRoom`);
      const occupiedRoomSnapshot = await get(occupiedRoomRef);
  
      if (occupiedRoomSnapshot.exists() && occupiedRoomSnapshot.val() !== selectedSchedule.room) {
        setErrorMessage('Error: You are already attending a class in another room.');
        return;
      }
  
      // Get the current date and time
      const currentTime = new Date().toLocaleString();
  
      const scheduleData = {
        schoolYear: selectedSchedule.schoolYear,
        semester: selectedSchedule.semester,
        facultyName: facultyName,
        subjectCode: selectedSchedule.subjectCode,
        subjectDescription: selectedSchedule.subjectDescription,
        course: selectedSchedule.course,
        day: selectedSchedule.day,
        time: selectedSchedule.time,
        building: selectedSchedule.building,
        room: selectedSchedule.room,
        attendedTime: currentTime,
      };
  
      // Include the 'attendendTime' field in selectedSchedule
      selectedSchedule.attendTime = currentTime;
  
      await set(ref(database, `rooms/${selectedSchedule.room}`), scheduleData, currentTime);
      await set(ref(database, `users/${userUid}/occupiedRoom`), selectedSchedule.room);
  
      setRoomOccupied(true);
      setSuccessMessage('You have successfully attended the class.');
      setErrorMessage('');
    }
  };
  

  
  const handleEndClass = async () => {
    setAttendingClass(false);
    setShowScanner(false);

    if (auth.currentUser) {
      const userUid = auth.currentUser.uid;

      set(ref(database, `users/${userUid}/occupiedRoom`), null);

      if (selectedSchedule.room) {
        const timeEnded = Date.now(); // Unix timestamp in milliseconds

        const historyRef = ref(database, `history`);

        try {
          const historySnapshot = await get(historyRef);

          if (historySnapshot.exists()) {
            const historyData = historySnapshot.val();

            // Update the existing entry for the specific room
            await set(historyRef, {
              ...historyData,
              [timeEnded.toString()]: {
                ...selectedSchedule,
                timeEnded: timeEnded,
              },
            });
          } else {
            // Create a new entry for the specific room
            await set(historyRef, {
              [timeEnded.toString()]: {
                ...selectedSchedule,
                timeEnded: timeEnded,
              },
            });
          }

          await set(ref(database, `rooms/${selectedSchedule.room}`), null);

          setRoomOccupied(false);
          setErrorMessage('');
          setSuccessMessage('You have successfully ended the class.');
        } catch (error) {
          console.error('Error updating history:', error);
          setErrorMessage('Error ending the class. Please try again.');
        }
      }
    }
  };

  const filterSchedulesByDay = (day) => {
    if (day === 'All') {
      setFacultySchedules([]);
      return;
    }

    const filteredSchedules = facultySchedules.filter((schedule) => schedule.day === day);
    setFacultySchedules(filteredSchedules);
  };

  navigator.mediaDevices
  .getUserMedia({ video: true })
  .then(function (stream) {
  })
  .catch(function (error) {
    console.error('Error accessing camera:', error);
  });

  const filterSchedulesBySchoolYearAndSemester = (schoolYear, semester) => {
    if (schoolYear === 'All' && semester === 'All') {
      setFacultySchedules([]);
      return;
    }

    const filteredSchedules = facultySchedules.filter((schedule) => {
      if (schoolYear === 'All') {
        return schedule.semester === semester;
      }
      if (semester === 'All') {
        return schedule.schoolYear === schoolYear;
      }
      return schedule.schoolYear === schoolYear && schedule.semester === semester;
    });

    setFacultySchedules(filteredSchedules);
  };

  return (
        <div className='h-screen justify-center flex items-center'>
          <div className="container ">
          <div className="row">
          <div className="col-12">
          <div className="content-wrapper">
            <h2 style={{ marginBottom: '20px', textAlign: 'left' }}>My Schedule</h2>
            <p style={{ fontFamily: 'Bold', marginBottom: '20px' }}>Welcome, {facultyName}!</p>

            <div className="row">
              <div className="content-wrapper">
                <div className="form-group">
                  <select
                    className="form-control"
                    onChange={(e) => {
                      setSelectedSchoolYear(e.target.value);
                      filterSchedulesBySchoolYearAndSemester(e.target.value, selectedSemester);
                    }}
                    value={selectedSchoolYear}
                  >
                    <option value="" disabled hidden>Choose a School Year</option>
                    <option value="All">All</option>
                    <option value="2022-2023">2022-2023</option>
                    <option value="2023-2024">2023-2024</option>
                    {/* Add more options for other school years */}
                  </select>
                </div>
              </div>
              <div className="content-wrapper">
                <div className="form-group">
                  <select
                    className="form-control"
                    onChange={(e) => {
                      setSelectedSemester(e.target.value);
                      filterSchedulesBySchoolYearAndSemester(selectedSchoolYear, e.target.value);
                    }}
                    value={selectedSemester}
                  >
                    <option value="" disabled hidden>Choose a Semester</option>
                    <option value="All">All</option>
                    <option value="1st Semester">1st Semester</option>
                    <option value="2nd Semester">2nd Semester</option>
                    <option value="Summer">Summer</option>
                    {/* Add more options for other semesters */}
                  </select>
                </div>
              </div>
              <div className="content-wrapper">
                <div className="form-group">
                  <select
                    className="form-control"
                    onChange={(e) => {
                      setSelectedDay(e.target.value);
                      filterSchedulesByDay(e.target.value);
                    }}
                    value={selectedDay}
                  >
                    <option value="" disabled hidden>Choose a Day</option>
                    <option value="All">All</option>
                    <option value="Mon/Wed">Mon/Wed</option>
                    <option value="Tue/Thurs">Tue/Thurs</option>
                    <option value="Fri/Sat">Fri/Sat</option>
                    <option value="Monday">Monday</option>
                    <option value="Tuesday">Tuesday</option>
                    <option value="Wednesday">Wednesday</option>
                    <option value="Thursday">Thursday</option>
                    <option value="Friday">Friday</option>
                    <option value="Saturday">Saturday</option>
                    {/* Add more options for other days */}
                  </select>
                </div>
              </div>
            </div>

            {loading ? (
              <p>Loading...</p>
            ) : facultySchedules.length === 0 ? (
              <p>No schedules available.</p>
            ) : (
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>School Year</th>
                      <th>Semester</th>
                      <th>Subject Code</th>
                      <th>Subject Description</th>
                      <th>Course</th>
                      <th>Day</th>
                      <th>Time</th>
                      <th>Building</th>
                      <th>Room</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facultySchedules.map((subject, index) => (
                      <tr key={index}>
                        <td>{subject.schoolYear}</td>
                        <td>{subject.semester}</td>
                        <td>{subject.subjectCode}</td>
                        <td>{subject.subjectDescription}</td>
                        <td>{subject.course}</td>
                        <td>{subject.day}</td>
                        <td>{subject.time}</td>
                        <td>{subject.building}</td>
                        <td>{subject.room}</td>
                        <td>
                          {roomOccupied ? (
                            <button className="btn btn-danger" onClick={handleEndClass}>End Class</button>
                          ) : attendingClass ? (
                            <button className="btn btn-primary" onClick={handleAttendClass}>Attend Class</button>
                          ) : (
                            <button className="btn btn-success" onClick={() => handleOpenScanner(subject)}>Open Scanner</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
         
      
          </div>
         

              </div>
          </div>



          </div>
          
          {showScanner && (
        <div className="fixed top-0 left-0 w-full h-full flex items-center justify-center backdrop-blur-sm bg-gray-200 ">
          <div className="absolute bg-white p-6 rounded-md shadow-md w-3/4 sm:w-3/4 md:w-1/2 lg:w-1/4 border border-5 border-red-800 ">
            <h2 className="text-lg font-semibold mb-4">Open Scanner for:</h2>
            <h2 className="text-2xl font-bold mb-4">Room {selectedSchedule?.room}</h2>
            <BarcodeScanner onDecodeResult={handleQrCodeScan} className="mx-auto mb-4 w-full" />

            {/* Display the scan result */}
            {scanResult && (
              <div>
                <p className="text-sm mb-1 font-normal">Scan Result</p>
                <p className="text-lg font-bold">{scanResult}</p>
              </div>
            )}
            
            {/* Buttons and messages */}
            <div className="mt-4">
              {isScannerOpen && (
                <button className="bg-red-600 text-white px-4 py-2 mr-2 sm:mr-0" onClick={handleCloseScanner}>
                  Close Scanner
                </button>
              )}
              {attendingClass && (
                <button className="bg-blue-600 text-white px-4 py-2" onClick={handleAttendClass}>
                  Attend Class
                </button>
              )}
              {errorMessage && <p className="text-red-500 mt-2">{errorMessage}</p>}
              {successMessage && <p className="text-green-500 mt-2">{successMessage}</p>}
            </div>
          </div>
        </div>
      )}

  </div>
  );
}

export default FacultySchedule;