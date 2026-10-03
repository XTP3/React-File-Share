import './Login.css';
import { Link } from 'react-router-dom';

function Login(props) {
    return (
        <form className="LoginForm" onSubmit={props.onSubmit}>
            <div className="Login">
                <div className="Input username">
                    <input type="text" className="UsernameInput" id="UsernameInput" placeholder="Username"></input>
                </div>
                <div className="Input password">
                    <input type="password" className="PasswordInput" id="PasswordInput" placeholder="Password"></input>
                </div>
                <div className="Input submit">
                    <Link to="/createaccount"><input type="button" className="CreateAccountInput" value="Create Account"></input></Link>
                    <input type="submit" className="SubmitInput" value="Login"></input>
                </div>
            </div>
        </form>
    );
}

export default Login;