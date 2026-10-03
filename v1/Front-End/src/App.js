import './App.css';
import Login from './components/Login';
import CreateAccount from './components/CreateAccount';
import Core from './components/Core';
import React, { useEffect, useState } from 'react';
import Authentication from './Authentication';
import { Route, Switch } from 'react-router-dom';

function App() {
  const [loggedIn, setLoggedIn] = useState(false);

  async function handleClick(event) { //Handle the login click
    event.preventDefault();
    let username = document.getElementById("UsernameInput").value;
    let password = document.getElementById("PasswordInput").value;
  
    if(username && password) {
      let loginResponse;
        try {
            loginResponse = await Authentication.performLogin(username, password);
            localStorage.setItem('token', loginResponse.data.token);
            setLoggedIn(true);

        }catch (error) {
            alert("Login Failed");
        }
  
    }else {
        alert("Invalid Input");
    }
    
  }
  
  function Serial(props) {
    let isLoggedIn = props.loggedIn;
  
    if(isLoggedIn) {
      return <Core />;
  
    }else {
      sessionStorage.removeItem('files');
      return <Login onSubmit={handleClick} />;
    }
  }
  
  useEffect(() => {
    async function verifyTokenAsync() {
      let currentToken = localStorage.getItem('token');
      let statusCode;
      try {
        const response = await Authentication.validateToken(currentToken);
        statusCode = response.status;

      }catch (e) {
        try {
          statusCode = e.response.status;
          
        }catch(err) {
          console.log(err);
        }
      }
      if(statusCode === 200) {
        setLoggedIn(true);

      }else {
        sessionStorage.removeItem('files');
        localStorage.removeItem('token'); 
        setLoggedIn(false);
      }
    }

    if(!localStorage.getItem('token')) {
      setLoggedIn(false);

    }else {
      verifyTokenAsync();
    }
  }, []);
  
  return (
    <div className="App">
      <Switch>
        <Route exact path="/createaccount" component={CreateAccount} />
        <Serial loggedIn={loggedIn} />
      </Switch>
    </div>
  );
}

export default App;